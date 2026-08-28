using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace BirdieWorld
{
    /// <summary>
    /// A small, genuinely rendered 3-D forecourt for the Beta 02 vertical slice.
    /// The scene is generated from Unity primitives so it has no downloadable
    /// dependencies and can be entered from the existing first-journey route.
    /// It owns presentation-only movement and never writes the character profile.
    /// </summary>
    public sealed class BirdieWorldThreeDWorld : MonoBehaviour
    {
        private readonly Color ink = new(0.008f, 0.018f, 0.016f, 1f);
        private readonly Color panel = new(0.020f, 0.065f, 0.048f, 0.94f);
        private readonly Color forest = new(0.08f, 0.30f, 0.16f, 1f);
        private readonly Color forestDeep = new(0.035f, 0.14f, 0.085f, 1f);
        private readonly Color gold = new(0.83f, 0.61f, 0.25f, 1f);
        private readonly Color ivory = new(0.95f, 0.92f, 0.83f, 1f);
        private readonly Color quiet = new(0.65f, 0.69f, 0.63f, 1f);

        private readonly List<Transform> worldLabels = new();
        private readonly List<RectTransform> touchTargets = new();
        private const float MinimumTouchTargetPixels = 44f;
        private Font font;
        private Action onReturnToJourney;
        private GameObject worldRoot;
        private GameObject environmentRoot;
        private GameObject playerRoot;
        private Camera worldCamera;
        private Canvas hudCanvas;
        private RectTransform hudRoot;
        private RectTransform objectivePanel;
        private RectTransform controlsPanel;
        private RectTransform touchControlsPanel;
        private RectTransform backPanel;
        private Text objectiveTitle;
        private Text objectiveBody;
        private Text profileText;
        private Text locationText;
        private Text hintText;
        private Text interactionText;
        private Text touchActionLabel;
        private UnityEngine.UI.Button touchActionButton;
        private Renderer playerCoat;
        private Renderer playerScarf;
        private Material playerMaterial;
        private Transform nestMarker;
        private Transform trainMarker;
        private CharacterProfile profile;
        private Mesh fallbackCubeMesh;
        private Vector3 playerPosition;
        private Vector3 cameraVelocity;
        private Color signatureColor;
        private string displayName = "DEIN BIRDIE";
        private bool hasArrivedAtNest;
        private Vector2 touchMovement;
        private int activeTouchPointerId = int.MinValue;
        private int layoutWidth;
        private int layoutHeight;
        private Rect layoutSafeArea;

        /// <summary>The overlay object used by the bootstrap screen router.</summary>
        public GameObject Screen { get; private set; }

        /// <summary>True while the generated world and its camera are active.</summary>
        public bool IsVisible => worldRoot != null && worldRoot.activeInHierarchy;

        public void Build(Font displayFont, Action returnToJourney)
        {
            if (worldRoot != null) return;

            font = displayFont != null ? displayFont : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            onReturnToJourney = returnToJourney;
            worldRoot = new GameObject("BirdieWorld3D");
            worldRoot.transform.SetParent(transform, false);
            environmentRoot = new GameObject("NestForecourtEnvironment");
            environmentRoot.transform.SetParent(worldRoot.transform, false);

            BuildCameraAndLight();
            BuildEnvironment();
            BuildHud();
            SetVisible(false);
        }

        public void Enter(CharacterProfile snapshot)
        {
            if (worldRoot == null) throw new InvalidOperationException("Build must be called before Enter.");
            profile = snapshot;
            CaptureReadOnlyProfile(snapshot);
            SetVisible(true);
            ResetWorldView();
        }

        public void Exit()
        {
            SetVisible(false);
        }

        /// <summary>Lets the parent router hide the world without firing the back action.</summary>
        public void SetVisible(bool visible)
        {
            if (worldRoot != null) worldRoot.SetActive(visible);
            if (Screen != null) Screen.SetActive(visible);
            if (visible) ResetWorldView();
            else ResetTouchInput();
        }

        private void OnDisable()
        {
            ResetTouchInput();
        }

        private void OnApplicationFocus(bool hasFocus)
        {
            if (!hasFocus) ResetTouchInput();
        }

        private void Update()
        {
            if (!IsVisible) return;
            ApplyResponsiveLayout();
            HandleMovement();
            UpdateCamera();
            UpdateWorldLabels();
            UpdateObjective();
        }

        private void BuildCameraAndLight()
        {
            var cameraObject = new GameObject("BirdieWorld3DCamera");
            cameraObject.transform.SetParent(worldRoot.transform, false);
            worldCamera = cameraObject.AddComponent<Camera>();
            worldCamera.clearFlags = CameraClearFlags.SolidColor;
            worldCamera.backgroundColor = new Color(0.025f, 0.055f, 0.095f, 1f);
            // A slightly higher, wider third-person angle keeps the playable
            // forecourt surface and the avatar readable on both desktop and
            // WebGL's dynamically-sized canvas. The old low angle hid the
            // character behind the near plaza edge.
            worldCamera.fieldOfView = 62f;
            worldCamera.nearClipPlane = 0.1f;
            worldCamera.farClipPlane = 240f;
            worldCamera.allowHDR = false;
            worldCamera.depth = -10f;

            var lightObject = new GameObject("BirdieWorldSun");
            lightObject.transform.SetParent(worldRoot.transform, false);
            lightObject.transform.rotation = Quaternion.Euler(42f, -28f, 0f);
            var sun = lightObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1.0f, 0.83f, 0.63f, 1f);
            sun.intensity = 1.25f;
            sun.shadows = LightShadows.Soft;

            var fillObject = new GameObject("BirdieWorldMoonFill");
            fillObject.transform.SetParent(worldRoot.transform, false);
            fillObject.transform.position = new Vector3(-8f, 7f, 12f);
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Point;
            fill.color = new Color(0.36f, 0.52f, 1f, 1f);
            fill.intensity = 2.6f;
            fill.range = 34f;
        }

        private void BuildEnvironment()
        {
            var path = CreateMaterial("WarmStone", new Color(0.74f, 0.46f, 0.20f, 1f), 0.05f, 0.35f, new Color(0.07f, 0.03f, 0.008f, 1f));
            var wood = CreateMaterial("DarkWood", new Color(0.25f, 0.12f, 0.06f, 1f), 0.05f, 0.25f);
            var roof = CreateMaterial("RoofGreen", new Color(0.045f, 0.17f, 0.12f, 1f), 0.1f, 0.25f);
            var brass = CreateMaterial("Brass", gold, 0.70f, 0.65f, new Color(0.15f, 0.08f, 0.015f, 1f));
            var water = CreateMaterial("River", new Color(0.06f, 0.30f, 0.46f, 1f), 0.15f, 0.75f);
            var mountain = CreateMaterial("Mountain", new Color(0.13f, 0.22f, 0.30f, 1f), 0.0f, 0.25f);
            var snow = CreateMaterial("Snow", new Color(0.78f, 0.84f, 0.86f, 1f), 0.0f, 0.35f);
            var foliage = CreateMaterial("Pine", new Color(0.035f, 0.22f, 0.12f, 1f), 0.0f, 0.2f);
            var foliageLight = CreateMaterial("PineLit", new Color(0.07f, 0.36f, 0.18f, 1f), 0.0f, 0.2f);
            var train = CreateMaterial("ExpressBlack", new Color(0.055f, 0.075f, 0.065f, 1f), 0.45f, 0.4f);
            var window = CreateMaterial("TrainWindow", new Color(0.24f, 0.48f, 0.58f, 1f), 0.25f, 0.75f, new Color(0.10f, 0.24f, 0.32f, 1f));

            // The forecourt uses segmented warm-stone tiles instead of one
            // unbroken slab. Besides reading more like a built 3-D plaza, the
            // gaps keep the horizon and the avatar silhouette visible on
            // WebGL variants whose built-in cube bounds differ from the editor.
            Primitive(PrimitiveType.Cube, "MainPath", new Vector3(0f, 0.36f, 12f), new Vector3(9f, 0.55f, 58f), path);
            for (var z = -5.0f; z <= 3.0f; z += 2.0f)
                Primitive(PrimitiveType.Cube, $"SpawnPlazaTile_{z:0}", new Vector3(0f, 0.50f, z), new Vector3(17f, 0.52f, 1.35f), path);
            Primitive(PrimitiveType.Cube, "SpawnPlazaEdge", new Vector3(0f, 0.90f, 4.3f), new Vector3(17f, 0.14f, 0.35f), brass);
            var plazaInlay = CreateMaterial("PlazaInlay", new Color(0.25f, 0.18f, 0.10f, 1f), 0.15f, 0.25f);
            for (var x = -7f; x <= 7f; x += 2.0f)
                Primitive(PrimitiveType.Cube, $"PlazaInlayX_{x:0}", new Vector3(x, 0.78f, -1f), new Vector3(0.055f, 0.035f, 10.2f), plazaInlay);
            for (var z = -5f; z <= 3f; z += 2.0f)
                Primitive(PrimitiveType.Cube, $"PlazaInlayZ_{z:0}", new Vector3(0f, 0.78f, z), new Vector3(16.8f, 0.035f, 0.055f), plazaInlay);
            Primitive(PrimitiveType.Cube, "River", new Vector3(0f, -0.02f, 12.5f), new Vector3(70f, 0.10f, 5.2f), water);
            Primitive(PrimitiveType.Cube, "Bridge", new Vector3(0f, 0.78f, 12.5f), new Vector3(10f, 0.38f, 8f), wood);
            Primitive(PrimitiveType.Cube, "BridgeRailLeft", new Vector3(-4.3f, 1.65f, 12.5f), new Vector3(0.22f, 1.5f, 8f), brass);
            Primitive(PrimitiveType.Cube, "BridgeRailRight", new Vector3(4.3f, 1.65f, 12.5f), new Vector3(0.22f, 1.5f, 8f), brass);

            BuildStation(wood, roof, brass, train, window);
            BuildNest(wood, roof, brass, window);
            BuildSideBuildings(wood, roof, brass, window);
            BuildMountainHorizon(mountain, snow);
            BuildTrees(foliage, foliageLight, wood);
            BuildLanterns(brass, wood);

            nestMarker = BuildMarker("NestArrivalMarker", new Vector3(0f, 0.86f, 24.0f), brass);
            trainMarker = BuildMarker("ExpressWorldMarker", new Vector3(0f, 0.86f, -4.0f), brass);
            CreateWorldLabel("TheNestLabel", "THE NEST", new Vector3(0f, 7.8f, 24.0f), 0.10f, gold);
            CreateWorldLabel("CoinShopLabel", "COIN SHOP", new Vector3(-15f, 5.5f, 18.0f), 0.07f, ivory);
            CreateWorldLabel("CafeLabel", "BIRDIE CAFE", new Vector3(15f, 5.5f, 20.0f), 0.07f, ivory);
        }

        private void BuildStation(Material wood, Material roof, Material brass, Material train, Material window)
        {
            Primitive(PrimitiveType.Cube, "StationPlatform", new Vector3(0f, 0.55f, -6f), new Vector3(18f, 0.8f, 10f), wood);
            Primitive(PrimitiveType.Cube, "StationCanopy", new Vector3(0f, 4.2f, -6f), new Vector3(18f, 0.35f, 8f), roof);
            Primitive(PrimitiveType.Cube, "StationCanopyLeft", new Vector3(-8.1f, 2.4f, -6f), new Vector3(0.35f, 4.0f, 0.35f), brass);
            Primitive(PrimitiveType.Cube, "StationCanopyRight", new Vector3(8.1f, 2.4f, -6f), new Vector3(0.35f, 4.0f, 0.35f), brass);
            Primitive(PrimitiveType.Cube, "RailLeft", new Vector3(-2.1f, 0.92f, -6f), new Vector3(0.12f, 0.12f, 15f), brass);
            Primitive(PrimitiveType.Cube, "RailRight", new Vector3(2.1f, 0.92f, -6f), new Vector3(0.12f, 0.12f, 15f), brass);

            var trainRoot = new GameObject("BirdieExpressWorldTrain");
            trainRoot.transform.SetParent(environmentRoot.transform, false);
            trainRoot.transform.position = new Vector3(5.7f, 1.8f, -6f);
            Primitive(PrimitiveType.Cube, "ExpressBody", Vector3.zero, new Vector3(5.2f, 2.4f, 8.5f), train, trainRoot.transform);
            Primitive(PrimitiveType.Cube, "ExpressWindowA", new Vector3(-1.05f, 0.45f, 1.5f), new Vector3(0.10f, 0.82f, 1.6f), window, trainRoot.transform);
            Primitive(PrimitiveType.Cube, "ExpressWindowB", new Vector3(-1.05f, 0.45f, -1.0f), new Vector3(0.10f, 0.82f, 1.6f), window, trainRoot.transform);
            Primitive(PrimitiveType.Cube, "ExpressWindowC", new Vector3(1.05f, 0.45f, 1.5f), new Vector3(0.10f, 0.82f, 1.6f), window, trainRoot.transform);
            Primitive(PrimitiveType.Cube, "ExpressWindowD", new Vector3(1.05f, 0.45f, -1.0f), new Vector3(0.10f, 0.82f, 1.6f), window, trainRoot.transform);
            Primitive(PrimitiveType.Cylinder, "ExpressWheelA", new Vector3(-1.7f, -1.1f, 2.0f), new Vector3(0.55f, 0.22f, 0.55f), brass, trainRoot.transform, Quaternion.Euler(90f, 0f, 0f));
            Primitive(PrimitiveType.Cylinder, "ExpressWheelB", new Vector3(1.7f, -1.1f, 2.0f), new Vector3(0.55f, 0.22f, 0.55f), brass, trainRoot.transform, Quaternion.Euler(90f, 0f, 0f));
        }

        private void BuildNest(Material wood, Material roof, Material brass, Material window)
        {
            var root = new GameObject("TheNestBuilding");
            root.transform.SetParent(environmentRoot.transform, false);
            root.transform.position = new Vector3(0f, 0f, 28f);
            Primitive(PrimitiveType.Cube, "NestMainHall", new Vector3(0f, 3.4f, 0f), new Vector3(14f, 6.8f, 8f), wood, root.transform);
            Primitive(PrimitiveType.Sphere, "NestRoof", new Vector3(0f, 7.9f, 0f), new Vector3(8.3f, 3.0f, 5.3f), roof, root.transform);
            Primitive(PrimitiveType.Cube, "NestDoorFrame", new Vector3(0f, 2.0f, -4.1f), new Vector3(3.4f, 4.0f, 0.35f), brass, root.transform);
            Primitive(PrimitiveType.Cube, "NestDoor", new Vector3(0f, 1.8f, -4.32f), new Vector3(2.5f, 3.4f, 0.24f), window, root.transform);
            Primitive(PrimitiveType.Cube, "NestWindowLeft", new Vector3(-4.2f, 3.6f, -4.15f), new Vector3(2.0f, 1.5f, 0.22f), window, root.transform);
            Primitive(PrimitiveType.Cube, "NestWindowRight", new Vector3(4.2f, 3.6f, -4.15f), new Vector3(2.0f, 1.5f, 0.22f), window, root.transform);
            Primitive(PrimitiveType.Cube, "NestPorch", new Vector3(0f, 0.55f, -5.8f), new Vector3(10f, 0.35f, 3.5f), brass, root.transform);
            Primitive(PrimitiveType.Cube, "NestSign", new Vector3(0f, 6.0f, -4.2f), new Vector3(6.2f, 1.25f, 0.25f), brass, root.transform);
        }

        private void BuildSideBuildings(Material wood, Material roof, Material brass, Material window)
        {
            BuildSmallBuilding("CoinShop", new Vector3(-15f, 0f, 18f), new Color(0.16f, 0.075f, 0.04f, 1f), wood, roof, brass, window);
            BuildSmallBuilding("BirdieCafe", new Vector3(15f, 0f, 20f), new Color(0.12f, 0.10f, 0.055f, 1f), wood, roof, brass, window);
        }

        private void BuildSmallBuilding(string name, Vector3 position, Color wallColor, Material wood, Material roof, Material brass, Material window)
        {
            var walls = CreateMaterial($"{name}Walls", wallColor, 0.05f, 0.3f);
            var root = new GameObject(name);
            root.transform.SetParent(environmentRoot.transform, false);
            root.transform.position = position;
            Primitive(PrimitiveType.Cube, $"{name}Body", new Vector3(0f, 2.0f, 0f), new Vector3(8f, 4f, 6f), walls, root.transform);
            Primitive(PrimitiveType.Sphere, $"{name}Roof", new Vector3(0f, 4.9f, 0f), new Vector3(5.0f, 1.6f, 4.0f), roof, root.transform);
            Primitive(PrimitiveType.Cube, $"{name}Door", new Vector3(0f, 1.4f, -3.1f), new Vector3(1.7f, 2.6f, 0.18f), brass, root.transform);
            Primitive(PrimitiveType.Cube, $"{name}Window", new Vector3(2.3f, 2.4f, -3.1f), new Vector3(1.6f, 1.3f, 0.18f), window, root.transform);
        }

        private void BuildMountainHorizon(Material mountain, Material snow)
        {
            var positions = new[]
            {
                new Vector3(-30f, 7f, 49f), new Vector3(-16f, 10f, 58f), new Vector3(2f, 13f, 64f),
                new Vector3(19f, 8f, 56f), new Vector3(34f, 12f, 48f)
            };
            var scales = new[] { 14f, 18f, 22f, 16f, 15f };
            for (var index = 0; index < positions.Length; index++)
            {
                Primitive(PrimitiveType.Cylinder, $"Mountain_{index}", positions[index], new Vector3(scales[index], scales[index], scales[index]), mountain);
                Primitive(PrimitiveType.Cylinder, $"SnowCap_{index}", positions[index] + new Vector3(0f, scales[index] * 0.60f, -0.05f), new Vector3(scales[index] * 0.38f, scales[index] * 0.35f, scales[index] * 0.38f), snow);
            }
        }

        private void BuildTrees(Material foliage, Material foliageLight, Material wood)
        {
            var positions = new[]
            {
                new Vector3(-24f, 0f, -1f), new Vector3(-19f, 0f, 8f), new Vector3(-25f, 0f, 18f),
                new Vector3(-23f, 0f, 31f), new Vector3(-17f, 0f, 38f), new Vector3(23f, 0f, 2f),
                new Vector3(20f, 0f, 10f), new Vector3(25f, 0f, 24f), new Vector3(20f, 0f, 34f),
                new Vector3(15f, 0f, 41f), new Vector3(-8f, 0f, 43f), new Vector3(9f, 0f, 47f)
            };
            for (var index = 0; index < positions.Length; index++)
                BuildTree($"Pine_{index}", positions[index], index % 3 == 0 ? foliageLight : foliage, wood, 0.85f + (index % 4) * 0.14f);
        }

        private void BuildTree(string name, Vector3 position, Material foliage, Material wood, float scale)
        {
            var root = new GameObject(name);
            root.transform.SetParent(environmentRoot.transform, false);
            root.transform.position = position;
            Primitive(PrimitiveType.Cylinder, "Trunk", new Vector3(0f, 1.6f * scale, 0f), new Vector3(0.36f * scale, 1.6f * scale, 0.36f * scale), wood, root.transform);
            Primitive(PrimitiveType.Sphere, "LowerCrown", new Vector3(0f, 3.0f * scale, 0f), new Vector3(2.2f * scale, 2.7f * scale, 2.2f * scale), foliage, root.transform);
            Primitive(PrimitiveType.Sphere, "UpperCrown", new Vector3(0f, 4.7f * scale, 0f), new Vector3(1.65f * scale, 2.2f * scale, 1.65f * scale), foliage, root.transform);
        }

        private void BuildLanterns(Material brass, Material wood)
        {
            var positions = new[] { new Vector3(-6.5f, 0f, -2f), new Vector3(6.5f, 0f, -2f), new Vector3(-6.0f, 0f, 23f), new Vector3(6.0f, 0f, 23f) };
            for (var index = 0; index < positions.Length; index++)
            {
                var root = new GameObject($"Lantern_{index}");
                root.transform.SetParent(environmentRoot.transform, false);
                root.transform.position = positions[index];
                Primitive(PrimitiveType.Cylinder, "Post", new Vector3(0f, 1.8f, 0f), new Vector3(0.18f, 1.8f, 0.18f), wood, root.transform);
                Primitive(PrimitiveType.Sphere, "Glow", new Vector3(0f, 3.6f, 0f), new Vector3(0.48f, 0.48f, 0.48f), brass, root.transform);
                var lightObject = new GameObject("WarmLight");
                lightObject.transform.SetParent(root.transform, false);
                lightObject.transform.localPosition = new Vector3(0f, 3.6f, 0f);
                var light = lightObject.AddComponent<Light>();
                light.type = LightType.Point;
                light.color = new Color(1f, 0.55f, 0.18f, 1f);
                light.intensity = 3.2f;
                light.range = 8f;
            }
        }

        private void BuildHud()
        {
            var canvasObject = new GameObject("BirdieWorld3D HUD", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            hudCanvas = canvasObject.GetComponent<Canvas>();
            hudCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            hudCanvas.overrideSorting = true;
            hudCanvas.sortingOrder = 100;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600f, 900f);
            scaler.matchWidthOrHeight = 0.5f;
            Screen = canvasObject;

            var root = new GameObject("WorldHudRoot", typeof(RectTransform));
            root.transform.SetParent(canvasObject.transform, false);
            hudRoot = root.GetComponent<RectTransform>();
            Stretch(hudRoot, Vector2.zero, Vector2.one);

            var header = Panel(root.transform, "WorldHeader", new Vector2(0.03f, 0.87f), new Vector2(0.97f, 0.98f), new Color(panel.r, panel.g, panel.b, 0.93f));
            AddOutline(header, new Color(gold.r, gold.g, gold.b, 0.70f), 1f);
            Label(header.transform, "BIRDIE & BREAKFAST", 26, gold, TextAnchor.MiddleLeft, new Vector2(0.025f, 0.45f), new Vector2(0.36f, 0.92f));
            locationText = Label(header.transform, "BIRDIEWORLD · THE NEST VORPLATZ · 3-D", 13, ivory, TextAnchor.MiddleLeft, new Vector2(0.025f, 0.10f), new Vector2(0.53f, 0.43f));
            profileText = Label(header.transform, "DEIN BIRDIE", 20, ivory, TextAnchor.MiddleRight, new Vector2(0.64f, 0.36f), new Vector2(0.97f, 0.86f));

            var objective = Panel(root.transform, "WorldObjective", new Vector2(0.72f, 0.49f), new Vector2(0.97f, 0.84f), new Color(panel.r, panel.g, panel.b, 0.92f));
            objectivePanel = objective.GetComponent<RectTransform>();
            AddOutline(objective, new Color(gold.r, gold.g, gold.b, 0.55f), 1f);
            Label(objective.transform, "DEIN NÄCHSTER ORT", 12, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.83f), new Vector2(0.92f, 0.95f));
            objectiveTitle = Label(objective.transform, "THE NEST · VORPLATZ", 23, ivory, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.64f), new Vector2(0.92f, 0.82f));
            objectiveBody = Label(objective.transform, "Freie Bewegung im ersten 3-D-Ort. Folge dem goldenen Marker zum Nest.", 14, quiet, TextAnchor.UpperLeft, new Vector2(0.08f, 0.30f), new Vector2(0.92f, 0.62f));
            Label(objective.transform, "BETA 02 · FORECOURT", 11, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.08f), new Vector2(0.92f, 0.20f));

            var controls = Panel(root.transform, "WorldControls", new Vector2(0.03f, 0.05f), new Vector2(0.47f, 0.16f), new Color(panel.r, panel.g, panel.b, 0.88f));
            controlsPanel = controls.GetComponent<RectTransform>();
            AddOutline(controls, new Color(gold.r, gold.g, gold.b, 0.45f), 1f);
            hintText = Label(controls.transform, "WASD / PFEILE · TOUCH-D-PAD · AKTION AM NEST", 12, ivory, TextAnchor.MiddleLeft, new Vector2(0.06f, 0.48f), new Vector2(0.94f, 0.90f));
            interactionText = Label(controls.transform, "GOLDENE MARKER FÜHREN DICH DURCH DIE WELT", 11, quiet, TextAnchor.MiddleLeft, new Vector2(0.06f, 0.12f), new Vector2(0.94f, 0.45f));

            var touchControls = Panel(root.transform, "WorldTouchControls", new Vector2(0.50f, 0.05f), new Vector2(0.70f, 0.25f), new Color(panel.r, panel.g, panel.b, 0.82f));
            touchControlsPanel = touchControls.GetComponent<RectTransform>();
            AddOutline(touchControls, new Color(gold.r, gold.g, gold.b, 0.55f), 1f);
            Label(touchControls.transform, "TOUCH · HALTEN ZUM LAUFEN", 11, quiet, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.82f), new Vector2(0.96f, 0.98f));
            TouchMovementButton(touchControls.transform, "↑", new Vector2(0.20f, 0.48f), new Vector2(0.39f, 0.79f), new Vector2(0f, 1f));
            TouchMovementButton(touchControls.transform, "←", new Vector2(0.05f, 0.12f), new Vector2(0.24f, 0.43f), new Vector2(-1f, 0f));
            TouchMovementButton(touchControls.transform, "↓", new Vector2(0.20f, 0.12f), new Vector2(0.39f, 0.43f), new Vector2(0f, -1f));
            TouchMovementButton(touchControls.transform, "→", new Vector2(0.35f, 0.12f), new Vector2(0.54f, 0.43f), new Vector2(1f, 0f));
            TouchActionButton(touchControls.transform, new Vector2(0.61f, 0.12f), new Vector2(0.95f, 0.79f));

            var back = Panel(root.transform, "WorldBack", new Vector2(0.72f, 0.05f), new Vector2(0.97f, 0.16f), new Color(0.07f, 0.055f, 0.03f, 0.95f));
            backPanel = back.GetComponent<RectTransform>();
            AddOutline(back, gold, 1f);
            var backButton = back.AddComponent<UnityEngine.UI.Button>();
            backButton.targetGraphic = back.GetComponent<Image>();
            backButton.navigation = new Navigation { mode = Navigation.Mode.None };
            backButton.onClick.AddListener(ReturnToJourney);
            Label(back.transform, "ZURÜCK ZUM ANKUNFTSPLATZ", 15, ivory, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.10f), new Vector2(0.96f, 0.90f));
        }

        private void CaptureReadOnlyProfile(CharacterProfile snapshot)
        {
            var rawName = snapshot?.displayName;
            displayName = string.IsNullOrWhiteSpace(rawName) ? "DEIN BIRDIE" : rawName.Trim();
            if (displayName.Length > 40) displayName = displayName.Substring(0, 40);
            signatureColor = SignatureFor(snapshot?.color);
            profileText.text = $"{displayName.ToUpperInvariant()} · {StoryFor(snapshot?.story)}";
            if (playerMaterial != null) playerMaterial.color = signatureColor;
            if (playerCoat != null) playerCoat.material.color = signatureColor;
            if (playerScarf != null) playerScarf.material.color = Color.Lerp(signatureColor, gold, 0.35f);
        }

        private void ResetWorldView()
        {
            ResetTouchInput();
            playerPosition = new Vector3(0f, 1.20f, -1.0f);
            hasArrivedAtNest = false;
            if (playerRoot == null)
                BuildPlayer();
            playerRoot.transform.position = playerPosition;
            cameraVelocity = Vector3.zero;
            if (worldCamera != null)
            {
                worldCamera.transform.position = playerPosition + new Vector3(0f, 8.8f, -13.8f);
                worldCamera.transform.LookAt(playerPosition + Vector3.up * 2.35f);
            }
            UpdateObjective();
        }

        private void BuildPlayer()
        {
            playerMaterial = CreateMaterial("PlayerCoat", forest, 0.1f, 0.35f);
            var headMaterial = CreateMaterial("PlayerHead", new Color(0.80f, 0.62f, 0.47f, 1f), 0.0f, 0.3f);
            var hairMaterial = CreateMaterial("PlayerHair", new Color(0.055f, 0.030f, 0.018f, 1f), 0.0f, 0.35f);
            var bootMaterial = CreateMaterial("PlayerBoots", ink, 0.1f, 0.2f);
            var scarfMaterial = CreateMaterial("PlayerScarf", gold, 0.3f, 0.5f);
            playerRoot = new GameObject("PlayerBirdie3D");
            playerRoot.transform.SetParent(worldRoot.transform, false);
            playerCoat = Primitive(PrimitiveType.Capsule, "PlayerCoat", new Vector3(0f, 1.18f, 0f), new Vector3(0.78f, 1.12f, 0.78f), playerMaterial, playerRoot.transform).GetComponent<Renderer>();
            Primitive(PrimitiveType.Sphere, "PlayerHead", new Vector3(0f, 2.35f, 0f), new Vector3(0.68f, 0.68f, 0.68f), headMaterial, playerRoot.transform);
            Primitive(PrimitiveType.Sphere, "PlayerHair", new Vector3(0f, 2.63f, -0.03f), new Vector3(0.72f, 0.37f, 0.72f), hairMaterial, playerRoot.transform);
            Primitive(PrimitiveType.Cube, "PlayerBootLeft", new Vector3(-0.25f, 0.24f, 0f), new Vector3(0.20f, 0.50f, 0.32f), bootMaterial, playerRoot.transform);
            Primitive(PrimitiveType.Cube, "PlayerBootRight", new Vector3(0.25f, 0.24f, 0f), new Vector3(0.20f, 0.50f, 0.32f), bootMaterial, playerRoot.transform);
            playerScarf = Primitive(PrimitiveType.Cube, "PlayerScarf", new Vector3(0f, 1.75f, -0.43f), new Vector3(0.78f, 0.13f, 0.12f), scarfMaterial, playerRoot.transform).GetComponent<Renderer>();
            // The slim brass pennant is a deliberate readability cue for the
            // third-person avatar at the default distance. It remains part of
            // the presentation-only player root and never touches profile or
            // economy state.
            Primitive(PrimitiveType.Cube, "PlayerPennantPole", new Vector3(0f, 3.15f, 0.12f), new Vector3(0.08f, 1.10f, 0.08f), scarfMaterial, playerRoot.transform);
            Primitive(PrimitiveType.Cube, "PlayerPennant", new Vector3(0.32f, 3.52f, 0.12f), new Vector3(0.62f, 0.42f, 0.08f), scarfMaterial, playerRoot.transform);
            CreateWorldLabel("PlayerLabel", "DEIN BIRDIE", new Vector3(0f, 4.15f, -1.0f), 0.045f, ivory, playerRoot.transform);
        }

        private void HandleMovement()
        {
            var horizontal = touchMovement.x;
            var vertical = touchMovement.y;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) horizontal -= 1f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) horizontal += 1f;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) vertical -= 1f;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) vertical += 1f;

            var movement = new Vector3(horizontal, 0f, vertical);
            if (movement.sqrMagnitude > 0.01f)
                MovePlayer(movement, 5.2f * Time.unscaledDeltaTime);

            if (Input.GetKeyDown(KeyCode.E) || Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.Space))
                InteractAtWorldMarker();
        }

        private void TouchMovementButton(Transform parent, string value, Vector2 min, Vector2 max, Vector2 direction)
        {
            var go = Panel(parent, $"TouchMove{value}", min, max, new Color(0.08f, 0.12f, 0.09f, 0.96f));
            AddOutline(go, new Color(gold.r, gold.g, gold.b, 0.78f), 1f);
            var button = go.AddComponent<UnityEngine.UI.Button>();
            button.targetGraphic = go.GetComponent<Image>();
            button.navigation = new Navigation { mode = Navigation.Mode.None };
            Label(go.transform, value, 24, ivory, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.05f), new Vector2(0.96f, 0.95f));
            touchTargets.Add(go.GetComponent<RectTransform>());

            var trigger = go.AddComponent<EventTrigger>();
            trigger.triggers = new List<EventTrigger.Entry>();
            AddTouchTrigger(trigger, EventTriggerType.PointerDown, eventData => BeginTouchMovement(eventData, direction));
            AddTouchTrigger(trigger, EventTriggerType.PointerUp, EndTouchMovement);
            // Each arrow is a discrete hold target: lifting or leaving releases
            // it. Swiping between direction buttons is intentionally not a gesture.
            AddTouchTrigger(trigger, EventTriggerType.PointerExit, EndTouchMovement);
            AddTouchTrigger(trigger, EventTriggerType.Cancel, EndTouchMovement);
        }

        private void TouchActionButton(Transform parent, Vector2 min, Vector2 max)
        {
            var go = Panel(parent, "WorldTouchAction", min, max, new Color(0.16f, 0.12f, 0.055f, 0.98f));
            AddOutline(go, gold, 1f);
            touchActionButton = go.AddComponent<UnityEngine.UI.Button>();
            touchActionButton.targetGraphic = go.GetComponent<Image>();
            touchActionButton.navigation = new Navigation { mode = Navigation.Mode.None };
            touchActionButton.onClick.AddListener(InteractAtWorldMarker);
            touchActionLabel = Label(go.transform, "NEST · 25 m", 17, ivory, TextAnchor.MiddleCenter, new Vector2(0.05f, 0.08f), new Vector2(0.95f, 0.92f));
            touchTargets.Add(go.GetComponent<RectTransform>());
        }

        private static void AddTouchTrigger(EventTrigger trigger, EventTriggerType eventType, Action<BaseEventData> action)
        {
            var entry = new EventTrigger.Entry
            {
                eventID = eventType,
                callback = new EventTrigger.TriggerEvent()
            };
            entry.callback.AddListener(eventData => action?.Invoke(eventData));
            trigger.triggers.Add(entry);
        }

        private void BeginTouchMovement(BaseEventData eventData, Vector2 direction)
        {
            if (eventData is PointerEventData pointer)
            {
                if (activeTouchPointerId != int.MinValue && pointer.pointerId != activeTouchPointerId) return;
                activeTouchPointerId = pointer.pointerId;
            }
            touchMovement = direction.normalized;
        }

        private void EndTouchMovement(BaseEventData eventData)
        {
            if (eventData is PointerEventData pointer && activeTouchPointerId != int.MinValue && pointer.pointerId != activeTouchPointerId)
                return;
            ResetTouchInput();
        }

        private void ResetTouchInput()
        {
            touchMovement = Vector2.zero;
            activeTouchPointerId = int.MinValue;
        }

        private void MovePlayer(Vector3 movement, float distance)
        {
            if (playerRoot == null || movement.sqrMagnitude <= 0.01f) return;
            movement.Normalize();
            playerPosition += movement * distance;
            playerPosition.x = Mathf.Clamp(playerPosition.x, -27f, 27f);
            playerPosition.z = Mathf.Clamp(playerPosition.z, -11f, 39f);
            playerRoot.transform.position = playerPosition;
            playerRoot.transform.rotation = Quaternion.LookRotation(movement, Vector3.up);
        }

        private void InteractAtWorldMarker()
        {
            if (nestMarker == null) return;
            var distance = Vector3.Distance(new Vector3(playerPosition.x, 0f, playerPosition.z), new Vector3(nestMarker.position.x, 0f, nestMarker.position.z));
            if (distance <= 4.2f)
            {
                hasArrivedAtNest = true;
                objectiveTitle.text = "THE NEST · TOR GEÖFFNET";
                objectiveBody.text = "Du bist im ersten 3-D-Ort angekommen. Der Vorplatz ist der Beta-02-Grenzpunkt.";
                hintText.text = "THE NEST BEGRÜSST DICH · BETA-02-REISE ABGESCHLOSSEN";
                interactionText.text = "ZURÜCK ZUM ANKUNFTSPLATZ ODER NOCH ETWAS FREI ERKUNDEN";
            }
            else
            {
                interactionText.text = "NOCH NICHT AM GOLDENEN NEST-MARKER · FOLGE DEM WEG";
            }
        }

        private void UpdateCamera()
        {
            if (worldCamera == null || playerRoot == null) return;
            var desired = playerRoot.transform.position + new Vector3(0f, 8.8f, -13.8f);
            worldCamera.transform.position = Vector3.SmoothDamp(worldCamera.transform.position, desired, ref cameraVelocity, 0.20f, 40f, Time.unscaledDeltaTime);
            worldCamera.transform.LookAt(playerRoot.transform.position + Vector3.up * 2.35f);
        }

        private void UpdateObjective()
        {
            if (objectiveTitle == null || playerRoot == null || nestMarker == null) return;
            var distance = Vector3.Distance(new Vector3(playerPosition.x, 0f, playerPosition.z), new Vector3(nestMarker.position.x, 0f, nestMarker.position.z));
            locationText.text = $"BIRDIEWORLD · THE NEST VORPLATZ · {distance:0.0} m ZUM NEST";
            if (touchActionButton != null) touchActionButton.interactable = !hasArrivedAtNest && distance <= 4.2f;
            if (touchActionLabel != null)
                touchActionLabel.text = hasArrivedAtNest ? "TOR GEÖFFNET" : distance <= 4.2f ? "AKTION · NEST" : $"NEST · {distance:0} m";
            if (hasArrivedAtNest) return;
            objectiveTitle.text = distance <= 4.2f ? "THE NEST · AKTION BEREIT" : "THE NEST · VORPLATZ";
            objectiveBody.text = distance <= 4.2f
                ? "Du stehst am goldenen Marker. Drücke E, Enter, Space oder nutze den Touch-Button."
                : "Freie Bewegung im ersten 3-D-Ort. Folge dem goldenen Marker zum Nest.";
        }

        private void UpdateWorldLabels()
        {
            if (worldCamera == null) return;
            foreach (var label in worldLabels)
            {
                if (label == null) continue;
                label.LookAt(worldCamera.transform);
                label.Rotate(0f, 180f, 0f);
            }
            var pulse = 1f + Mathf.Sin(Time.unscaledTime * 3.4f) * 0.10f;
            if (nestMarker != null) nestMarker.localScale = new Vector3(pulse, 1f, pulse);
            if (trainMarker != null) trainMarker.localScale = new Vector3(1f + Mathf.Sin(Time.unscaledTime * 2.4f) * 0.06f, 1f, 1f + Mathf.Sin(Time.unscaledTime * 2.4f) * 0.06f);
        }

        private void ReturnToJourney()
        {
            SetVisible(false);
            onReturnToJourney?.Invoke();
        }

        private Transform BuildMarker(string name, Vector3 position, Material material)
        {
            var marker = Primitive(PrimitiveType.Cylinder, name, position, new Vector3(1.25f, 0.08f, 1.25f), material).transform;
            return marker;
        }

        private GameObject CreateWorldLabel(string name, string value, Vector3 position, float characterSize, Color color, Transform parent = null)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent ?? environmentRoot.transform, false);
            go.transform.localPosition = position;
            var mesh = go.AddComponent<TextMesh>();
            mesh.text = value;
            mesh.font = font;
            mesh.fontSize = 64;
            mesh.characterSize = characterSize;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
            mesh.color = color;
            worldLabels.Add(go.transform);
            return go;
        }

        private GameObject Primitive(PrimitiveType type, string name, Vector3 position, Vector3 scale, Material material, Transform parent = null, Quaternion? rotation = null)
        {
            // Unity's standard primitive factory also adds a physics collider.
            // The beta intentionally ships without the Physics module, so
            // construct the render-only primitive from built-in meshes instead.
            var go = new GameObject(name);
            go.transform.SetParent(parent ?? environmentRoot.transform, false);
            go.transform.localPosition = position;
            go.transform.localScale = scale;
            if (rotation.HasValue) go.transform.localRotation = rotation.Value;

            var meshFilter = go.AddComponent<MeshFilter>();
            meshFilter.sharedMesh = BuiltInMesh(type);
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            return go;
        }

        private Mesh BuiltInMesh(PrimitiveType type)
        {
            var resourceName = type switch
            {
                PrimitiveType.Sphere => "New-Sphere.fbx",
                PrimitiveType.Capsule => "Capsule.fbx",
                PrimitiveType.Cylinder => "Cylinder.fbx",
                PrimitiveType.Plane => "Plane.fbx",
                PrimitiveType.Quad => "Quad.fbx",
                _ => "Cube.fbx"
            };

            try
            {
                var mesh = Resources.GetBuiltinResource<Mesh>(resourceName);
                if (mesh != null) return mesh;
            }
            catch (Exception)
            {
                // Some Unity versions expose the sphere mesh under a different
                // built-in name. A render-only cube keeps the world visible in
                // that case without reintroducing the unavailable Physics module.
            }

            if (fallbackCubeMesh != null) return fallbackCubeMesh;
            fallbackCubeMesh = new Mesh { name = "BirdieWorldFallbackCube" };
            fallbackCubeMesh.vertices = new[]
            {
                new Vector3(-0.5f, -0.5f, -0.5f), new Vector3(0.5f, -0.5f, -0.5f),
                new Vector3(0.5f, 0.5f, -0.5f), new Vector3(-0.5f, 0.5f, -0.5f),
                new Vector3(-0.5f, -0.5f, 0.5f), new Vector3(0.5f, -0.5f, 0.5f),
                new Vector3(0.5f, 0.5f, 0.5f), new Vector3(-0.5f, 0.5f, 0.5f)
            };
            fallbackCubeMesh.triangles = new[]
            {
                0, 2, 1, 0, 3, 2, 1, 2, 6, 1, 6, 5,
                4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
                3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4
            };
            fallbackCubeMesh.RecalculateNormals();
            return fallbackCubeMesh;
        }

        private Material CreateMaterial(string name, Color color, float metallic, float smoothness, Color? emission = null)
        {
            // WebGL strips shaders that are only requested dynamically. Keep the
            // Standard lookup for editor/desktop lighting, then fall back to the
            // UI shader which is guaranteed to ship with this Canvas-only beta.
            var shader = Resources.Load<Shader>("BirdieWorldColor")
                ?? Shader.Find("BirdieWorld/Color")
                ?? Shader.Find("Standard")
                ?? Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Sprites/Default")
                ?? Shader.Find("UI/Default");
            if (shader == null)
            {
                Debug.LogError($"BirdieWorld 3D material '{name}' could not find a compatible shader.");
                return null;
            }

            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", smoothness);
            if (material.HasProperty("_EmissionColor"))
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", emission ?? new Color(color.r * 0.08f, color.g * 0.08f, color.b * 0.08f, 1f));
            }
            return material;
        }

        private void ApplyResponsiveLayout(bool force = false)
        {
            if (hudRoot == null) return;
            var safeArea = UnityEngine.Screen.safeArea;
            if (!force && layoutWidth == UnityEngine.Screen.width && layoutHeight == UnityEngine.Screen.height && layoutSafeArea == safeArea) return;
            layoutWidth = UnityEngine.Screen.width;
            layoutHeight = UnityEngine.Screen.height;
            layoutSafeArea = safeArea;
            ApplySafeArea(safeArea);
            var portrait = layoutHeight > layoutWidth;
            if (portrait)
            {
                Stretch(objectivePanel, new Vector2(0.05f, 0.59f), new Vector2(0.95f, 0.80f));
                controlsPanel.gameObject.SetActive(false);
                Stretch(touchControlsPanel, new Vector2(0.05f, 0.18f), new Vector2(0.95f, 0.53f));
                Stretch(backPanel, new Vector2(0.05f, 0.05f), new Vector2(0.95f, 0.14f));
            }
            else
            {
                Stretch(objectivePanel, new Vector2(0.72f, 0.49f), new Vector2(0.97f, 0.84f));
                controlsPanel.gameObject.SetActive(true);
                Stretch(controlsPanel, new Vector2(0.03f, 0.05f), new Vector2(0.47f, 0.16f));
                Stretch(touchControlsPanel, new Vector2(0.50f, 0.05f), new Vector2(0.70f, 0.25f));
                Stretch(backPanel, new Vector2(0.72f, 0.05f), new Vector2(0.97f, 0.16f));
            }
            EnsureMinimumTouchTargets();
        }

        private void ApplySafeArea(Rect safeArea)
        {
            if (layoutWidth <= 0 || layoutHeight <= 0) return;
            var safeMin = safeArea.position;
            var safeMax = safeArea.position + safeArea.size;
            safeMin.x /= layoutWidth;
            safeMin.y /= layoutHeight;
            safeMax.x /= layoutWidth;
            safeMax.y /= layoutHeight;
            hudRoot.anchorMin = safeMin;
            hudRoot.anchorMax = safeMax;
            hudRoot.offsetMin = Vector2.zero;
            hudRoot.offsetMax = Vector2.zero;
        }

        private void EnsureMinimumTouchTargets()
        {
            foreach (var target in touchTargets)
            {
                if (target == null) continue;
                target.offsetMin = Vector2.zero;
                target.offsetMax = Vector2.zero;
                target.sizeDelta = Vector2.zero;
            }
            Canvas.ForceUpdateCanvases();
            var scaleFactor = hudCanvas != null ? Mathf.Max(0.01f, hudCanvas.scaleFactor) : 1f;
            var minimumUnits = MinimumTouchTargetPixels / scaleFactor;
            foreach (var target in touchTargets)
            {
                if (target == null) continue;
                var missingWidth = Mathf.Max(0f, minimumUnits - target.rect.width);
                var missingHeight = Mathf.Max(0f, minimumUnits - target.rect.height);
                target.sizeDelta += new Vector2(missingWidth, missingHeight);
            }
        }

        private Text Label(Transform parent, string value, int size, Color color, TextAnchor anchor, Vector2 min, Vector2 max)
        {
            var go = new GameObject("Text", typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var text = go.GetComponent<Text>();
            text.font = font;
            text.text = value;
            text.fontSize = size;
            text.color = color;
            text.alignment = anchor;
            text.resizeTextForBestFit = true;
            text.resizeTextMinSize = 9;
            text.resizeTextMaxSize = size;
            text.supportRichText = false;
            return text;
        }

        private GameObject Panel(Transform parent, string name, Vector2 min, Vector2 max, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = color;
            return go;
        }

        private void AddOutline(GameObject go, Color color, float distance)
        {
            var outline = go.AddComponent<Outline>();
            outline.effectColor = color;
            outline.effectDistance = new Vector2(distance, distance);
        }

        private static void Stretch(RectTransform rect, Vector2 min, Vector2 max)
        {
            if (rect == null) return;
            rect.anchorMin = min;
            rect.anchorMax = max;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
        }

        private static Color SignatureFor(string value)
        {
            return value?.Trim().ToLowerInvariant() switch
            {
                "midnight" => new Color(0.10f, 0.20f, 0.46f, 1f),
                "sand" => new Color(0.60f, 0.43f, 0.25f, 1f),
                "burgundy" => new Color(0.44f, 0.10f, 0.13f, 1f),
                _ => new Color(0.035f, 0.22f, 0.13f, 1f)
            };
        }

        private static string StoryFor(string value)
        {
            return value?.Trim().ToLowerInvariant() switch
            {
                "strategist" => "STRATEG:IN",
                "connoisseur" => "GENIESSER:IN",
                _ => "ENTDECKER:IN"
            };
        }
    }
}
