using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;

namespace BirdieWorld.Foundation
{
    public sealed class BirdieWorldFoundationRuntime : MonoBehaviour
    {
        internal const string ManifestResourcePath = "BirdieWorld/birdieworld-estate-handoff-v1";

        [SerializeField] private TextAsset estateManifest;
        [SerializeField] private bool buildOnStart = true;

        private readonly Dictionary<string, Material> materials = new();
        private bool hasBuilt;

        public void SetManifestAsset(TextAsset source) => estateManifest = source;

        public void EnsureManifestAsset()
        {
            if (estateManifest == null)
            {
                estateManifest = Resources.Load<TextAsset>(ManifestResourcePath);
            }
        }

        private void Start()
        {
            if (buildOnStart && !hasBuilt)
            {
                TryBuildFoundation();
            }
        }

        private void TryBuildFoundation()
        {
            try
            {
                EnsureManifestAsset();
                BuildFoundation();
            }
            catch (Exception exception)
            {
                Debug.LogException(exception, this);
                BirdieWorldRuntimeFailure.Show(exception);
            }
        }

        [ContextMenu("Build BirdieWorld Foundation")]
        public void BuildFoundation()
        {
            var manifest = BirdieWorldEstateManifest.ParseAndValidate(estateManifest);
            ClearGeneratedRoot();

            var generated = new GameObject("BirdieEstate_Generated");
            generated.transform.SetParent(transform, false);

            BuildMaterials(manifest.visual.palette);
            BuildGround(manifest, generated.transform);
            BuildComposition(manifest, generated.transform);
            BuildCollisionVolumes(manifest, generated.transform);
            BuildAmbientScaleMarkers(manifest, generated.transform);
            BuildLighting(manifest, generated.transform);
            BuildPlayerAndCamera(manifest, generated.transform);
            hasBuilt = true;
        }

        private void ClearGeneratedRoot()
        {
            var existing = transform.Find("BirdieEstate_Generated");
            if (existing != null)
            {
                Destroy(existing.gameObject);
            }
        }

        private void BuildMaterials(Palette palette)
        {
            materials.Clear();
            AddMaterial("ground", palette.meadowDark);
            AddMaterial("path", palette.path);
            AddMaterial("hotel", palette.hotel);
            AddMaterial("stable", palette.stable);
            AddMaterial("water", palette.water);
            AddMaterial("green", palette.green);
            AddMaterial("forest", palette.forest);
            AddMaterial("cream", palette.cream);
            AddMaterial("gold", palette.gold);
            AddMaterial("charcoal", palette.charcoal);
            AddMaterial("wood", palette.wood);
        }

        private void AddMaterial(string token, string htmlColor)
        {
            var shader = ResolveFoundationShader();
            var material = new Material(shader) { name = $"BW_{token}" };
            if (ColorUtility.TryParseHtmlString(htmlColor, out var color))
            {
                material.color = color;
            }
            materials[token] = material;
        }

        private static Shader ResolveFoundationShader()
        {
            var activePipeline = GraphicsSettings.currentRenderPipeline;
            var shader = activePipeline == null
                ? Shader.Find("Standard")
                : activePipeline.defaultShader;
            if (shader == null)
            {
                throw new InvalidOperationException("No compatible foundation shader is available.");
            }

            return shader;
        }

        private void BuildGround(BirdieWorldEstateManifest manifest, Transform parent)
        {
            var ground = CreatePrimitive(PrimitiveType.Cube, "estate-ground", parent, materials["ground"]);
            ground.transform.position = new Vector3(0f, -0.15f, 0f);
            ground.transform.localScale = new Vector3(manifest.worldBounds.groundSize.x, 0.3f, manifest.worldBounds.groundSize.z);
        }

        private void BuildComposition(BirdieWorldEstateManifest manifest, Transform parent)
        {
            foreach (var landmark in manifest.landmarks ?? Array.Empty<LandmarkSpec>())
            {
                var primitive = LandmarkPrimitive(landmark.id);
                var token = LandmarkMaterialToken(landmark.id);
                var marker = CreatePrimitive(primitive, landmark.id, parent, materials[token]);
                marker.transform.position = BirdieWorldEstateManifest.ToUnityPosition(landmark.anchor);
                marker.transform.localScale = LandmarkScale(landmark.id);
                RemoveCollider(marker);

                if (landmark.id == "formal-gardens")
                {
                    BuildFormalGardens(marker.transform.position, parent);
                }
            }
        }

        private void BuildFormalGardens(Vector3 center, Transform parent)
        {
            foreach (var side in new[] { -1f, 1f })
            {
                var garden = CreatePrimitive(PrimitiveType.Cube, $"formal-garden-{side}", parent, materials["forest"]);
                garden.transform.position = center + new Vector3(side * 8.7f, 0.08f, 0f);
                garden.transform.localScale = new Vector3(6.8f, 0.16f, 14.2f);
                RemoveCollider(garden);
            }
        }

        private void BuildCollisionVolumes(BirdieWorldEstateManifest manifest, Transform parent)
        {
            foreach (var rectangle in manifest.collisionShapes.rectangles ?? Array.Empty<CollisionRectangle>())
            {
                var centerX = (rectangle.minX + rectangle.maxX) * 0.5f;
                var centerCanonicalZ = (rectangle.minZ + rectangle.maxZ) * 0.5f;
                var width = rectangle.maxX - rectangle.minX;
                var depth = rectangle.maxZ - rectangle.minZ;
                var token = rectangle.id.Contains("stable") ? "stable" : "hotel";
                var height = rectangle.id.Contains("stable") ? 4.5f : 8f;
                var building = CreatePrimitive(PrimitiveType.Cube, rectangle.id, parent, materials[token]);
                building.transform.position = new Vector3(centerX, height * 0.5f, -centerCanonicalZ);
                building.transform.localScale = new Vector3(width, height, depth);
            }

            foreach (var circle in manifest.collisionShapes.circles ?? Array.Empty<CollisionCircle>())
            {
                var pond = CreatePrimitive(PrimitiveType.Cylinder, circle.id, parent, materials["water"]);
                pond.transform.position = new Vector3(circle.x, 0.04f, -circle.z);
                pond.transform.localScale = new Vector3(circle.radius, 0.08f, circle.radius);
            }
        }

        private void BuildAmbientScaleMarkers(BirdieWorldEstateManifest manifest, Transform parent)
        {
            foreach (var person in manifest.ambientPopulation ?? Array.Empty<AmbientPersonSpec>())
            {
                var token = materials.ContainsKey(person.shirtMaterial) ? person.shirtMaterial : "cream";
                var marker = CreatePrimitive(PrimitiveType.Capsule, person.id, parent, materials[token]);
                marker.transform.position = BirdieWorldEstateManifest.ToUnityPosition(person.anchor) + Vector3.up;
                marker.transform.rotation = Quaternion.Euler(0f, BirdieWorldEstateManifest.ToUnityYaw(person.yawDegrees), 0f);
                marker.transform.localScale = new Vector3(0.55f, 1f, 0.55f);
                RemoveCollider(marker);
            }
        }

        private void BuildLighting(BirdieWorldEstateManifest manifest, Transform parent)
        {
            var palette = manifest.visual.palette;
            if (ColorUtility.TryParseHtmlString(palette.skyHaze, out var ambient))
            {
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
                RenderSettings.ambientLight = ambient * 0.62f;
            }

            var sunObject = new GameObject("GoldenHour_Sun");
            sunObject.transform.SetParent(parent, false);
            var sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = manifest.visual.lighting.sun.intensity;
            sun.color = ParseColor(palette.warmLight, new Color(1f, 0.76f, 0.42f));
            sunObject.transform.rotation = Quaternion.Euler(42f, -38f, 0f);
            RenderSettings.sun = sun;

            var fillObject = new GameObject("Cool_Fill");
            fillObject.transform.SetParent(parent, false);
            fillObject.transform.position = BirdieWorldEstateManifest.ToUnityPosition(manifest.visual.lighting.coolFill.position);
            var fill = fillObject.AddComponent<Light>();
            fill.type = LightType.Point;
            fill.range = 120f;
            fill.intensity = manifest.visual.lighting.coolFill.intensity;
            fill.color = ParseColor(manifest.visual.lighting.coolFill.color, new Color(0.56f, 0.68f, 0.62f));
        }

        private void BuildPlayerAndCamera(BirdieWorldEstateManifest manifest, Transform parent)
        {
            var player = CreatePrimitive(PrimitiveType.Capsule, "foundation-player", parent, materials["charcoal"]);
            Destroy(player.GetComponent<Collider>());
            player.transform.position = BirdieWorldEstateManifest.ToUnityPosition(manifest.player.spawn) + Vector3.up;
            player.transform.rotation = Quaternion.Euler(0f, BirdieWorldEstateManifest.ToUnityYaw(manifest.player.spawn.yawDegrees), 0f);
            player.layer = 2;

            var controller = player.AddComponent<CharacterController>();
            controller.height = 2f;
            controller.radius = 0.45f;
            controller.center = Vector3.zero;

            var cameraObject = new GameObject("BirdieWorld_Camera");
            cameraObject.transform.SetParent(parent, false);
            var camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = manifest.camera.nearClip;
            camera.farClipPlane = manifest.camera.farClip;
            cameraObject.tag = "MainCamera";

            var follow = cameraObject.AddComponent<BirdieWorldThirdPersonCamera>();
            follow.Configure(player.transform, manifest.camera);

            var walker = player.AddComponent<BirdieWorldFoundationWalker>();
            walker.Configure(controller, camera.transform, manifest.player);

            var accountObject = new GameObject("BirdieWorld_AccountGate");
            accountObject.transform.SetParent(parent, false);
            var accountGate = accountObject.AddComponent<BirdieWorldAccountGate>();
            accountGate.Configure(walker);
        }

        private GameObject CreatePrimitive(PrimitiveType primitive, string stableId, Transform parent, Material material)
        {
            var instance = GameObject.CreatePrimitive(primitive);
            instance.name = $"BW_{stableId}";
            instance.transform.SetParent(parent, false);
            instance.GetComponent<Renderer>().sharedMaterial = material;
            instance.AddComponent<BirdieWorldStableId>().SetStableId(stableId);
            return instance;
        }

        private static void RemoveCollider(GameObject instance)
        {
            var collider = instance.GetComponent<Collider>();
            if (collider != null)
            {
                Destroy(collider);
            }
        }

        private static PrimitiveType LandmarkPrimitive(string id)
        {
            return id is "arrival-court" or "putting-green" or "golf-pond" ? PrimitiveType.Cylinder : PrimitiveType.Cube;
        }

        private static string LandmarkMaterialToken(string id)
        {
            if (id.Contains("hotel")) return "hotel";
            if (id.Contains("stable")) return "stable";
            if (id.Contains("pond") || id.Contains("lake")) return "water";
            if (id.Contains("green") || id.Contains("garden")) return "green";
            if (id.Contains("bridge")) return "wood";
            return "path";
        }

        private static Vector3 LandmarkScale(string id)
        {
            return id switch
            {
                "arrival-court" => new Vector3(12f, 0.08f, 12f),
                "entrance-bridge" => new Vector3(6.4f, 0.35f, 8.5f),
                "formal-gardens" => new Vector3(1.2f, 0.25f, 1.2f),
                "hotel-terrace" => new Vector3(12f, 0.25f, 7f),
                "putting-green" => new Vector3(8f, 0.08f, 8f),
                "golf-pond" => new Vector3(8.5f, 0.08f, 8.5f),
                "lake-pavilion" => new Vector3(7f, 3.5f, 7f),
                _ => new Vector3(3f, 3f, 3f)
            };
        }

        private static Color ParseColor(string html, Color fallback)
        {
            return ColorUtility.TryParseHtmlString(html, out var parsed) ? parsed : fallback;
        }
    }

    public static class BirdieWorldRuntimeBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void EnsureFoundationRuntime()
        {
            var runtime = UnityEngine.Object.FindFirstObjectByType<BirdieWorldFoundationRuntime>();
            if (runtime == null)
            {
                var root = new GameObject("BirdieWorld_Foundation_RuntimeBootstrap");
                runtime = root.AddComponent<BirdieWorldFoundationRuntime>();
            }

            runtime.EnsureManifestAsset();
        }
    }

    public sealed class BirdieWorldRuntimeFailure : MonoBehaviour
    {
        private string diagnostic = "BirdieWorld konnte nicht gestartet werden.";
        private GUIStyle cardStyle;
        private GUIStyle titleStyle;
        private GUIStyle bodyStyle;
        private Texture2D cardTexture;

        public static void Show(Exception exception)
        {
            EnsureFallbackCamera();

            var existing = UnityEngine.Object.FindFirstObjectByType<BirdieWorldRuntimeFailure>();
            var overlay = existing != null
                ? existing
                : new GameObject("BirdieWorld_RuntimeFailure").AddComponent<BirdieWorldRuntimeFailure>();
            overlay.diagnostic = $"Startfehler: {exception.GetType().Name}. Bitte neu laden oder den Test-Link melden.";
        }

        private static void EnsureFallbackCamera()
        {
            if (Camera.main != null) return;

            var cameraObject = new GameObject("BirdieWorld_FallbackCamera");
            cameraObject.tag = "MainCamera";
            var fallbackCamera = cameraObject.AddComponent<Camera>();
            fallbackCamera.clearFlags = CameraClearFlags.SolidColor;
            fallbackCamera.backgroundColor = new Color(0.015f, 0.035f, 0.028f, 1f);
        }

        private void OnGUI()
        {
            EnsureStyles();
            var width = Mathf.Min(Screen.width - 32f, 560f);
            var height = 190f;
            var rect = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f, width, height);
            GUI.Box(rect, GUIContent.none, cardStyle);
            GUI.Label(new Rect(rect.x + 24f, rect.y + 22f, rect.width - 48f, 44f), "BIRDIEWORLD", titleStyle);
            GUI.Label(new Rect(rect.x + 24f, rect.y + 76f, rect.width - 48f, 88f), diagnostic, bodyStyle);
        }

        private void EnsureStyles()
        {
            if (cardStyle != null) return;

            cardTexture = new Texture2D(1, 1);
            cardTexture.SetPixel(0, 0, new Color(0.025f, 0.075f, 0.055f, 0.96f));
            cardTexture.Apply();

            cardStyle = new GUIStyle(GUI.skin.box)
            {
                normal = { background = cardTexture }
            };
            titleStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = Mathf.Clamp(Screen.width / 20, 20, 34),
                fontStyle = FontStyle.Bold,
                normal = { textColor = new Color(0.88f, 0.66f, 0.27f) }
            };
            bodyStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.UpperCenter,
                fontSize = Mathf.Clamp(Screen.width / 34, 14, 20),
                wordWrap = true,
                normal = { textColor = new Color(0.95f, 0.92f, 0.82f) }
            };
        }

        private void OnDestroy()
        {
            if (cardTexture != null)
            {
                Destroy(cardTexture);
            }
        }
    }

    public sealed class BirdieWorldFoundationWalker : MonoBehaviour
    {
        private CharacterController controller;
        private Transform view;
        private PlayerSpec player;
        private Vector2 pointerOrigin;
        private bool pointerActive;

        public void Configure(CharacterController characterController, Transform cameraTransform, PlayerSpec playerSpec)
        {
            controller = characterController;
            view = cameraTransform;
            player = playerSpec;
        }

        private void Update()
        {
            if (controller == null || view == null || player == null) return;

            var input = ReadInput();
            var forward = Vector3.ProjectOnPlane(view.forward, Vector3.up).normalized;
            var right = Vector3.ProjectOnPlane(view.right, Vector3.up).normalized;
            var direction = Vector3.ClampMagnitude(forward * input.y + right * input.x, 1f);

            if (direction.sqrMagnitude > 0.001f)
            {
                controller.SimpleMove(direction * player.movementSpeedMetersPerSecond);
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(direction), 12f * Time.deltaTime);
            }

            var position = transform.position;
            position.x = Mathf.Clamp(position.x, player.movementBounds.minX, player.movementBounds.maxX);
            position.z = Mathf.Clamp(position.z, -player.movementBounds.maxZ, -player.movementBounds.minZ);
            transform.position = position;
        }

        private Vector2 ReadInput()
        {
            var result = Vector2.zero;
            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                result.x += (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed ? 1f : 0f) -
                            (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed ? 1f : 0f);
                result.y += (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed ? 1f : 0f) -
                            (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed ? 1f : 0f);
            }

            var touchscreen = Touchscreen.current;
            if (touchscreen != null && touchscreen.primaryTouch.press.isPressed)
            {
                var position = touchscreen.primaryTouch.position.ReadValue();
                if (!pointerActive)
                {
                    pointerOrigin = position;
                    pointerActive = true;
                }
                result += Vector2.ClampMagnitude((position - pointerOrigin) / 90f, 1f);
            }
            else
            {
                var mouse = Mouse.current;
                if (mouse != null && mouse.leftButton.isPressed)
                {
                    var position = mouse.position.ReadValue();
                    if (!pointerActive)
                    {
                        pointerOrigin = position;
                        pointerActive = true;
                    }
                    result += Vector2.ClampMagnitude((position - pointerOrigin) / 90f, 1f);
                }
                else
                {
                    pointerActive = false;
                }
            }

            return Vector2.ClampMagnitude(result, 1f);
        }
    }

    public sealed class BirdieWorldThirdPersonCamera : MonoBehaviour
    {
        private Transform target;
        private CameraSpec cameraSpec;
        private Camera attachedCamera;

        public void Configure(Transform followTarget, CameraSpec spec)
        {
            target = followTarget;
            cameraSpec = spec;
            attachedCamera = GetComponent<Camera>();
        }

        private void LateUpdate()
        {
            if (target == null || cameraSpec == null || attachedCamera == null) return;

            var profile = Screen.width <= cameraSpec.compact.maxViewportWidth
                ? (CameraProfile)cameraSpec.compact
                : cameraSpec.desktop;
            attachedCamera.fieldOfView = profile.fieldOfViewDegrees;

            var forward = target.forward;
            var focus = target.position + Vector3.up * 1.2f + forward * profile.lookAhead;
            var desired = target.position - forward * profile.distance + Vector3.up * profile.height;
            var origin = target.position + Vector3.up * 1.5f;
            var ray = desired - origin;
            var distance = ray.magnitude;
            if (distance > 0.001f && Physics.SphereCast(origin, 0.28f, ray.normalized, out var hit, distance, ~(1 << 2), QueryTriggerInteraction.Ignore))
            {
                desired = origin + ray.normalized * Mathf.Max(0.5f, hit.distance - cameraSpec.collisionSampleStep);
            }

            transform.position = Vector3.Lerp(transform.position, desired, 10f * Time.deltaTime);
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(focus - transform.position), 12f * Time.deltaTime);
        }
    }
}
