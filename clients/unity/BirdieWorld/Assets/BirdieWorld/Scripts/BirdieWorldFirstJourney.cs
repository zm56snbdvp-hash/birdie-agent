using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    /// <summary>
    /// A deterministic, self-contained first journey for Beta 02. The controller only
    /// renders a read-only snapshot of the supplied character and never persists it.
    /// </summary>
    public sealed class BirdieWorldFirstJourney : MonoBehaviour
    {
        private enum JourneyStage
        {
            MeetLeni,
            ReadMap,
            BoardTrain,
            Traveling,
            Arrived
        }

        private static readonly Vector2Int StartCell = new(0, 0);
        private static readonly Vector2Int LeniCell = new(2, 0);
        private static readonly Vector2Int MapCell = new(4, 3);
        private static readonly Vector2Int TrainCell = new(6, 4);

        private readonly HashSet<Vector2Int> obstacles = new()
        {
            new Vector2Int(1, 1),
            new Vector2Int(1, 2),
            new Vector2Int(2, 2),
            new Vector2Int(4, 1),
            new Vector2Int(5, 1),
            new Vector2Int(5, 3)
        };

        private readonly List<UnityEngine.UI.Button> movementButtons = new();
        private readonly Text[] stepLabels = new Text[3];

        private readonly Color ink = new(0.010f, 0.025f, 0.021f, 1f);
        private readonly Color panel = new(0.022f, 0.070f, 0.052f, 0.98f);
        private readonly Color forest = new(0.030f, 0.155f, 0.102f, 1f);
        private readonly Color forestLight = new(0.045f, 0.205f, 0.135f, 1f);
        private readonly Color gold = new(0.83f, 0.61f, 0.25f, 1f);
        private readonly Color ivory = new(0.95f, 0.92f, 0.83f, 1f);
        private readonly Color quiet = new(0.66f, 0.66f, 0.59f, 1f);

        private Action onReturnToStart;
        private Font font;
        private GameObject journeyRoot;
        private GameObject platformScreen;
        private GameObject travelScreen;
        private GameObject arrivalScreen;
        private RectTransform headerLayout;
        private RectTransform platformLayout;
        private RectTransform guideLayout;
        private RectTransform controlsLayout;
        private RectTransform interactionLayout;
        private RectTransform travelCardLayout;
        private RectTransform arrivalCardLayout;
        private RectTransform playerMarker;
        private RectTransform travelTrain;
        private RectTransform travelProgress;
        private Image playerCoat;
        private Image profileCoat;
        private Image profileSignature;
        private Image interactionBackground;
        private UnityEngine.UI.Button interactionButton;
        private Text interactionLabel;
        private Text objectiveTitle;
        private Text objectiveBody;
        private Text positionLabel;
        private Text feedbackLabel;
        private Text profileName;
        private Text profileStory;
        private Text playerName;
        private Text travelChapter;
        private Text travelStatus;
        private Text arrivalName;
        private JourneyStage stage;
        private Vector2Int playerCell;
        private Color signatureColor;
        private string displayName = "DEIN BIRDIE";
        private string storyName = "ENTDECKER:IN";
        private Coroutine travelCoroutine;
        private int journeyGeneration;
        private int layoutWidth;
        private int layoutHeight;
        private float markerTime;
        private bool rootWasVisible;

        /// <summary>The internally owned full-screen object, exposed read-only for screen routing.</summary>
        public GameObject Screen { get; private set; }

        public void Build(Transform parent, Font font, Action returnToStart)
        {
            if (journeyRoot != null) return;
            if (parent == null) throw new ArgumentNullException(nameof(parent));

            this.font = font != null ? font : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            onReturnToStart = returnToStart;
            journeyRoot = Panel(parent, "FirstJourney", Vector2.zero, Vector2.one, ink);
            Screen = journeyRoot;
            BuildPlatformScreen();
            BuildTravelScreen();
            BuildArrivalScreen();
            ApplyResponsiveLayout(true);
            journeyRoot.SetActive(false);
        }

        /// <summary>
        /// Opens a fresh journey using only a defensive display snapshot of the profile.
        /// </summary>
        public void Enter(CharacterProfile profile)
        {
            if (journeyRoot == null) throw new InvalidOperationException("Build must be called before Enter.");
            CaptureReadOnlyProfile(profile);
            journeyRoot.SetActive(true);
            rootWasVisible = true;
            ResetJourney();
        }

        /// <summary>
        /// Cancels all active animation work and restores the first guided step. This does
        /// not reveal a screen which a parent router has deliberately hidden.
        /// </summary>
        public void ResetJourney()
        {
            journeyGeneration++;
            StopAllCoroutines();
            travelCoroutine = null;
            stage = JourneyStage.MeetLeni;
            playerCell = StartCell;
            markerTime = 0f;

            if (platformScreen == null) return;
            platformScreen.SetActive(true);
            travelScreen.SetActive(false);
            arrivalScreen.SetActive(false);
            SetMarkerCell(playerMarker, playerCell);
            feedbackLabel.text = "FOLGE DEN GOLDENEN STATIONEN · BEWEGUNG MIT WASD, PFEILTASTEN ODER TOUCH";
            UpdateGuidance();
            ApplyResponsiveLayout(true);
        }

        private void Update()
        {
            if (journeyRoot == null) return;
            var visible = journeyRoot.activeInHierarchy;
            if (!visible)
            {
                if (rootWasVisible && travelCoroutine != null)
                {
                    journeyGeneration++;
                    StopAllCoroutines();
                    travelCoroutine = null;
                }
                rootWasVisible = false;
                return;
            }

            rootWasVisible = true;
            ApplyResponsiveLayout();
            AnimatePlayerMarker();

            if (!CanMove()) return;
            if (Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.UpArrow)) TryMove(0, 1);
            else if (Input.GetKeyDown(KeyCode.S) || Input.GetKeyDown(KeyCode.DownArrow)) TryMove(0, -1);
            else if (Input.GetKeyDown(KeyCode.A) || Input.GetKeyDown(KeyCode.LeftArrow)) TryMove(-1, 0);
            else if (Input.GetKeyDown(KeyCode.D) || Input.GetKeyDown(KeyCode.RightArrow)) TryMove(1, 0);
            else if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter) ||
                     Input.GetKeyDown(KeyCode.Space))
                InteractAtCurrentCell();
        }

        private void OnDestroy()
        {
            journeyGeneration++;
            StopAllCoroutines();
            travelCoroutine = null;
        }

        private void BuildPlatformScreen()
        {
            platformScreen = Panel(journeyRoot.transform, "ExpressPlatform", Vector2.zero, Vector2.one, ink);
            BirdieWorldArt.Cover(platformScreen.transform, "PlatformNightArt", "BirdieWorldArt/platform-night", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(platformScreen.transform, "PlatformAtmosphere", Vector2.zero, Vector2.one, new Color(0.004f, 0.015f, 0.011f, 0.34f));

            var header = Panel(platformScreen.transform, "JourneyHeader", new Vector2(0.03f, 0.86f), new Vector2(0.97f, 0.98f), new Color(panel.r, panel.g, panel.b, 0.94f));
            headerLayout = header.GetComponent<RectTransform>();
            AddOutline(header, new Color(gold.r, gold.g, gold.b, 0.55f), 1f);
            Label(header.transform, "BIRDIE & BREAKFAST", 25, gold, TextAnchor.MiddleLeft, new Vector2(0.025f, 0.52f), new Vector2(0.49f, 0.92f));
            Label(header.transform, "BIRDIEWORLD · BAHNSTEIG · BETA 02", 15, ivory, TextAnchor.MiddleLeft, new Vector2(0.025f, 0.10f), new Vector2(0.49f, 0.48f));

            profileSignature = Shape(header.transform, "ProfileSignature", new Vector2(0.55f, 0.12f), new Vector2(0.64f, 0.88f), gold);
            profileSignature.color = new Color(gold.r, gold.g, gold.b, 0.18f);
            var portrait = CreateHumanFigure(header.transform, "ReadOnlyHumanProfile", new Vector2(0.565f, 0.14f), new Vector2(0.625f, 0.86f), gold, string.Empty, false);
            profileCoat = portrait.coat;
            profileName = Label(header.transform, "DEIN BIRDIE", 21, ivory, TextAnchor.LowerLeft, new Vector2(0.66f, 0.40f), new Vector2(0.97f, 0.87f));
            profileStory = Label(header.transform, "ENTDECKER:IN · NUR ANZEIGE", 12, gold, TextAnchor.UpperLeft, new Vector2(0.66f, 0.10f), new Vector2(0.97f, 0.42f));

            var platform = Panel(platformScreen.transform, "SevenByFivePlatform", new Vector2(0.03f, 0.18f), new Vector2(0.70f, 0.84f), new Color(0.013f, 0.043f, 0.033f, 0.76f));
            platformLayout = platform.GetComponent<RectTransform>();
            AddOutline(platform, gold, 2f);
            BuildGrid(platform.transform);

            var guide = Panel(platformScreen.transform, "JourneyGuide", new Vector2(0.73f, 0.42f), new Vector2(0.97f, 0.84f), new Color(panel.r, panel.g, panel.b, 0.94f));
            guideLayout = guide.GetComponent<RectTransform>();
            AddOutline(guide, new Color(gold.r, gold.g, gold.b, 0.55f), 1f);
            Label(guide.transform, "DEIN NÄCHSTER SCHRITT", 13, gold, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.86f), new Vector2(0.93f, 0.96f));
            objectiveTitle = Label(guide.transform, "LENI TREFFEN", 25, ivory, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.70f), new Vector2(0.93f, 0.86f));
            objectiveBody = Label(guide.transform, string.Empty, 15, quiet, TextAnchor.UpperLeft, new Vector2(0.07f, 0.49f), new Vector2(0.93f, 0.70f));
            stepLabels[0] = Label(guide.transform, "01  LENI TREFFEN", 14, ivory, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.36f), new Vector2(0.93f, 0.47f));
            stepLabels[1] = Label(guide.transform, "02  STRECKENKARTE LESEN", 14, quiet, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.25f), new Vector2(0.93f, 0.36f));
            stepLabels[2] = Label(guide.transform, "03  BIRDIE EXPRESS BESTEIGEN", 14, quiet, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.14f), new Vector2(0.93f, 0.25f));
            positionLabel = Label(guide.transform, "POSITION · BAHNSTEIG 1–1", 12, gold, TextAnchor.MiddleLeft, new Vector2(0.07f, 0.04f), new Vector2(0.93f, 0.13f));

            var controls = Panel(platformScreen.transform, "TouchMovement", new Vector2(0.73f, 0.18f), new Vector2(0.97f, 0.39f), new Color(0.018f, 0.053f, 0.041f, 0.94f));
            controlsLayout = controls.GetComponent<RectTransform>();
            Label(controls.transform, "BEWEGEN · WASD / PFEILE / TOUCH · AKTION ↵", 11, quiet, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.82f), new Vector2(0.96f, 0.98f));
            MovementButton(controls.transform, "↑", new Vector2(0.38f, 0.48f), new Vector2(0.62f, 0.80f), 0, 1);
            MovementButton(controls.transform, "←", new Vector2(0.12f, 0.10f), new Vector2(0.36f, 0.42f), -1, 0);
            MovementButton(controls.transform, "↓", new Vector2(0.38f, 0.10f), new Vector2(0.62f, 0.42f), 0, -1);
            MovementButton(controls.transform, "→", new Vector2(0.64f, 0.10f), new Vector2(0.88f, 0.42f), 1, 0);

            var interaction = Panel(platformScreen.transform, "ExactCellInteraction", new Vector2(0.73f, 0.06f), new Vector2(0.97f, 0.15f), new Color(0.07f, 0.10f, 0.075f, 0.96f));
            interactionLayout = interaction.GetComponent<RectTransform>();
            interactionBackground = interaction.GetComponent<Image>();
            AddOutline(interaction, gold, 2f);
            interactionButton = interaction.AddComponent<UnityEngine.UI.Button>();
            interactionButton.targetGraphic = interactionBackground;
            interactionButton.navigation = new Navigation { mode = Navigation.Mode.None };
            interactionButton.onClick.AddListener(InteractAtCurrentCell);
            interactionLabel = Label(interaction.transform, "MIT LENI SPRECHEN", 17, ivory, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.18f), new Vector2(0.96f, 0.86f));

            feedbackLabel = Label(platformScreen.transform, string.Empty, 11, quiet, TextAnchor.MiddleLeft, new Vector2(0.03f, 0.07f), new Vector2(0.70f, 0.15f));
        }

        private void BuildGrid(Transform parent)
        {
            for (var y = 0; y < 5; y++)
            for (var x = 0; x < 7; x++)
            {
                var cell = new Vector2Int(x, y);
                var min = new Vector2(x / 7f, y / 5f);
                var max = new Vector2((x + 1f) / 7f, (y + 1f) / 5f);
                var blocked = obstacles.Contains(cell);
                var baseColor = blocked
                    ? new Color(0.055f, 0.061f, 0.049f, 1f)
                    : ((x + y) % 2 == 0 ? forest : forestLight);
                var color = new Color(baseColor.r, baseColor.g, baseColor.b, blocked ? 0.90f : 0.78f);
                var tile = Panel(parent, $"Cell_{x}_{y}", min, max, color);
                var rect = tile.GetComponent<RectTransform>();
                rect.offsetMin = new Vector2(2f, 2f);
                rect.offsetMax = new Vector2(-2f, -2f);
                tile.GetComponent<Image>().raycastTarget = false;
                Label(tile.transform, $"{x + 1}·{y + 1}", 10, new Color(ivory.r, ivory.g, ivory.b, 0.17f), TextAnchor.LowerRight, new Vector2(0.60f, 0.02f), new Vector2(0.96f, 0.24f));
                if (blocked)
                {
                    Shape(tile.transform, "TravelLuggage", new Vector2(0.23f, 0.30f), new Vector2(0.77f, 0.68f), new Color(0.25f, 0.19f, 0.105f, 1f));
                    Label(tile.transform, "GEPÄCK", 9, quiet, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.05f), new Vector2(0.92f, 0.28f));
                }
            }

            var leni = CreateHumanFigure(parent, "HumanLeni", Vector2.zero, Vector2.one, gold, "LENI", true);
            SetMarkerCell(leni.root, LeniCell, 0.18f);

            var map = Panel(parent, "RouteMap", Vector2.zero, Vector2.one, new Color(0.76f, 0.67f, 0.45f, 1f));
            map.GetComponent<Image>().raycastTarget = false;
            AddOutline(map, gold, 2f);
            Label(map.transform, "STRECKEN-\nKARTE", 11, ink, TextAnchor.MiddleCenter, new Vector2(0.06f, 0.12f), new Vector2(0.94f, 0.88f));
            SetMarkerCell(map.GetComponent<RectTransform>(), MapCell, 0.19f);

            var train = Panel(parent, "BirdieExpress", Vector2.zero, Vector2.one, new Color(0.10f, 0.115f, 0.09f, 1f));
            train.GetComponent<Image>().raycastTarget = false;
            AddOutline(train, gold, 2f);
            Label(train.transform, "BIRDIE\nEXPRESS", 11, gold, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.12f), new Vector2(0.96f, 0.88f));
            SetMarkerCell(train.GetComponent<RectTransform>(), TrainCell, 0.13f);

            var player = CreateHumanFigure(parent, "ReadOnlyPlayer", Vector2.zero, Vector2.one, forestLight, displayName, true);
            playerMarker = player.root;
            playerCoat = player.coat;
            playerName = player.label;
            SetMarkerCell(playerMarker, StartCell, 0.16f);
            playerMarker.SetAsLastSibling();
        }

        private void BuildTravelScreen()
        {
            travelScreen = Panel(journeyRoot.transform, "ExpressJourney", Vector2.zero, Vector2.one, ink);
            BirdieWorldArt.Cover(travelScreen.transform, "ExpressJourneyArt", "BirdieWorldArt/express-journey", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(travelScreen.transform, "JourneyAtmosphere", Vector2.zero, Vector2.one, new Color(0.004f, 0.012f, 0.010f, 0.28f));
            var card = Panel(travelScreen.transform, "JourneyWindow", new Vector2(0.12f, 0.12f), new Vector2(0.88f, 0.88f), new Color(panel.r, panel.g, panel.b, 0.91f));
            travelCardLayout = card.GetComponent<RectTransform>();
            AddOutline(card, gold, 2f);
            Label(card.transform, "BIRDIE EXPRESS", 17, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.87f), new Vector2(0.92f, 0.96f));
            travelChapter = Label(card.transform, "TIEF DURCH DAS TAL", 38, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.72f), new Vector2(0.92f, 0.87f));
            travelStatus = Label(card.transform, "ABFAHRT · BAHNSTEIG", 15, quiet, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.63f), new Vector2(0.90f, 0.72f));

            var window = Panel(card.transform, "ValleyAndMountainWindow", new Vector2(0.07f, 0.23f), new Vector2(0.93f, 0.62f), new Color(0.025f, 0.12f, 0.09f, 0.70f));
            AddOutline(window, new Color(gold.r, gold.g, gold.b, 0.45f), 1f);
            BirdieWorldArt.Cover(window.transform, "RoutePanoramaArt", "BirdieWorldArt/express-journey", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(window.transform, "RoutePanoramaTint", Vector2.zero, Vector2.one, new Color(0.004f, 0.012f, 0.010f, 0.12f));
            Label(window.transform, "TAL", 12, new Color(ivory.r, ivory.g, ivory.b, 0.65f), TextAnchor.LowerLeft, new Vector2(0.04f, 0.08f), new Vector2(0.30f, 0.28f));
            Label(window.transform, "BERGKAMM", 12, new Color(ivory.r, ivory.g, ivory.b, 0.65f), TextAnchor.UpperRight, new Vector2(0.70f, 0.67f), new Vector2(0.96f, 0.88f));

            var rail = Shape(window.transform, "Rail", new Vector2(0.04f, 0.43f), new Vector2(0.96f, 0.47f), new Color(0.77f, 0.63f, 0.38f, 1f));
            rail.raycastTarget = false;
            var movingTrain = Panel(window.transform, "MovingExpress", Vector2.zero, Vector2.one, new Color(0.055f, 0.070f, 0.058f, 1f));
            travelTrain = movingTrain.GetComponent<RectTransform>();
            travelTrain.anchorMin = new Vector2(-0.18f, 0.37f);
            travelTrain.anchorMax = new Vector2(0.02f, 0.58f);
            travelTrain.offsetMin = travelTrain.offsetMax = Vector2.zero;
            AddOutline(movingTrain, gold, 2f);
            Label(movingTrain.transform, "EXPRESS", 12, gold, TextAnchor.MiddleCenter, new Vector2(0.05f, 0.10f), new Vector2(0.95f, 0.90f));

            var progressTrack = Panel(card.transform, "RouteProgressTrack", new Vector2(0.12f, 0.13f), new Vector2(0.88f, 0.17f), new Color(0.05f, 0.065f, 0.055f, 1f));
            var progress = Panel(progressTrack.transform, "RouteProgress", Vector2.zero, Vector2.one, gold);
            travelProgress = progress.GetComponent<RectTransform>();
            Label(card.transform, "BIRKEN-TAL   ·   FLUSSSTRECKE   ·   THE NEST", 12, quiet, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.06f), new Vector2(0.90f, 0.12f));
        }

        private void BuildArrivalScreen()
        {
            arrivalScreen = Panel(journeyRoot.transform, "NestForecourtArrival", Vector2.zero, Vector2.one, new Color(0.012f, 0.040f, 0.030f, 1f));
            BirdieWorldArt.Cover(arrivalScreen.transform, "NestForecourtArt", "BirdieWorldArt/nest-forecourt", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(arrivalScreen.transform, "ArrivalAtmosphere", Vector2.zero, Vector2.one, new Color(0.004f, 0.015f, 0.011f, 0.24f));
            var card = Panel(arrivalScreen.transform, "ArrivalCard", new Vector2(0.18f, 0.12f), new Vector2(0.82f, 0.88f), new Color(panel.r, panel.g, panel.b, 0.90f));
            arrivalCardLayout = card.GetComponent<RectTransform>();
            AddOutline(card, gold, 2f);
            Label(card.transform, "BIRDIE EXPRESS · ANGEKOMMEN", 17, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.85f), new Vector2(0.92f, 0.94f));
            Label(card.transform, "THE NEST · VORPLATZ", 46, ivory, TextAnchor.MiddleCenter, new Vector2(0.07f, 0.65f), new Vector2(0.93f, 0.84f));
            Label(card.transform, "DIE ERSTE REISE IST GESCHAFFT.", 19, gold, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.55f), new Vector2(0.90f, 0.64f));
            arrivalName = Label(card.transform, "WILLKOMMEN, DEIN BIRDIE.", 25, ivory, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.40f), new Vector2(0.90f, 0.53f));
            Label(card.transform, "Leni wartet am Tor. Dieser Vorplatz ist das Ende der Beta-02-Reise.", 15, quiet, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.31f), new Vector2(0.88f, 0.40f));
            MakeButton(card.transform, "REISE NOCH EINMAL", new Vector2(0.09f, 0.12f), new Vector2(0.47f, 0.25f), ResetJourney);
            MakeButton(card.transform, "ZURÜCK ZUM START", new Vector2(0.53f, 0.12f), new Vector2(0.91f, 0.25f), ReturnToStart);
        }

        private void CaptureReadOnlyProfile(CharacterProfile profile)
        {
            var rawName = profile?.displayName;
            displayName = string.IsNullOrWhiteSpace(rawName) ? "DEIN BIRDIE" : rawName.Trim();
            if (displayName.Length > 40) displayName = displayName.Substring(0, 40);
            signatureColor = SignatureFor(profile?.color);
            storyName = StoryFor(profile?.story);

            profileName.text = displayName.ToUpperInvariant();
            profileStory.text = $"{storyName} · NUR ANZEIGE";
            profileCoat.color = signatureColor;
            profileSignature.color = new Color(signatureColor.r, signatureColor.g, signatureColor.b, 0.22f);
            playerCoat.color = signatureColor;
            playerName.text = displayName.ToUpperInvariant();
            arrivalName.text = $"WILLKOMMEN, {displayName.ToUpperInvariant()}.";
        }

        private void TryMove(int x, int y)
        {
            if (!CanMove()) return;
            var next = playerCell + new Vector2Int(x, y);
            if (next.x < 0 || next.x >= 7 || next.y < 0 || next.y >= 5)
            {
                feedbackLabel.text = "HIER ENDET DER BAHNSTEIG · WÄHLE EINEN ANDEREN WEG.";
                return;
            }
            if (obstacles.Contains(next))
            {
                feedbackLabel.text = "REISEGEPÄCK BLOCKIERT DIESES FELD · GEH DARUM HERUM.";
                return;
            }

            playerCell = next;
            markerTime = 0f;
            SetMarkerCell(playerMarker, playerCell);
            feedbackLabel.text = playerCell == ObjectiveCell()
                ? "ZIELFELD ERREICHT · NUTZE JETZT DIE GOLDENE AKTION."
                : "WEITER ZUR GOLD MARKIERTEN STATION.";
            UpdateGuidance();
        }

        private bool CanMove()
        {
            return platformScreen != null && platformScreen.activeInHierarchy &&
                   stage != JourneyStage.Traveling && stage != JourneyStage.Arrived;
        }

        private void InteractAtCurrentCell()
        {
            if (!CanMove() || playerCell != ObjectiveCell()) return;

            switch (stage)
            {
                case JourneyStage.MeetLeni:
                    stage = JourneyStage.ReadMap;
                    feedbackLabel.text = "LENI: „SCHÖN, DASS DU DA BIST. DIE STRECKENKARTE ZEIGT UNS DEN WEG.“";
                    break;
                case JourneyStage.ReadMap:
                    stage = JourneyStage.BoardTrain;
                    feedbackLabel.text = "ROUTE GELESEN · DER BIRDIE EXPRESS STEHT ZUR ABFAHRT BEREIT.";
                    break;
                case JourneyStage.BoardTrain:
                    BeginTrainJourney();
                    return;
            }
            UpdateGuidance();
        }

        private void BeginTrainJourney()
        {
            stage = JourneyStage.Traveling;
            UpdateGuidance();
            travelTrain.anchorMin = new Vector2(-0.18f, 0.39f);
            travelTrain.anchorMax = new Vector2(0.02f, 0.60f);
            travelTrain.offsetMin = travelTrain.offsetMax = Vector2.zero;
            travelProgress.anchorMin = Vector2.zero;
            travelProgress.anchorMax = new Vector2(0f, 1f);
            travelProgress.offsetMin = travelProgress.offsetMax = Vector2.zero;
            travelChapter.text = "TIEF DURCH DAS TAL";
            travelStatus.text = "ABFAHRT · BAHNSTEIG";
            platformScreen.SetActive(false);
            travelScreen.SetActive(true);
            arrivalScreen.SetActive(false);
            var generation = ++journeyGeneration;
            travelCoroutine = StartCoroutine(AnimateTrainJourney(generation));
        }

        private IEnumerator AnimateTrainJourney(int generation)
        {
            const float duration = 4.2f;
            var elapsed = 0f;
            while (elapsed < duration && generation == journeyGeneration)
            {
                elapsed += Time.unscaledDeltaTime;
                var progress = Mathf.Clamp01(elapsed / duration);
                var eased = progress * progress * (3f - 2f * progress);
                var x = Mathf.Lerp(-0.18f, 0.98f, eased);
                var valley = Mathf.Sin(progress * Mathf.PI);
                var y = Mathf.Lerp(0.39f, 0.58f, progress) - valley * 0.20f;
                travelTrain.anchorMin = new Vector2(x, y);
                travelTrain.anchorMax = new Vector2(x + 0.20f, y + 0.21f);
                travelTrain.offsetMin = travelTrain.offsetMax = Vector2.zero;
                travelProgress.anchorMin = Vector2.zero;
                travelProgress.anchorMax = new Vector2(eased, 1f);
                travelProgress.offsetMin = travelProgress.offsetMax = Vector2.zero;

                if (progress < 0.34f)
                {
                    travelChapter.text = "TIEF DURCH DAS TAL";
                    travelStatus.text = "ABFAHRT · BIRKEN-TAL";
                }
                else if (progress < 0.68f)
                {
                    travelChapter.text = "AM FLUSS ENTLANG";
                    travelStatus.text = "TALSOHLE · RUHIGE FAHRT";
                }
                else
                {
                    travelChapter.text = "HOCH ZUM NEST";
                    travelStatus.text = "BERGFAHRT · ANKUNFT NAHT";
                }
                yield return null;
            }

            if (generation != journeyGeneration) yield break;
            travelCoroutine = null;
            stage = JourneyStage.Arrived;
            travelScreen.SetActive(false);
            arrivalScreen.SetActive(true);
        }

        private void ReturnToStart()
        {
            journeyGeneration++;
            StopAllCoroutines();
            travelCoroutine = null;
            rootWasVisible = false;
            journeyRoot.SetActive(false);
            onReturnToStart?.Invoke();
        }

        private void UpdateGuidance()
        {
            var target = ObjectiveCell();
            positionLabel.text = $"POSITION · BAHNSTEIG {playerCell.x + 1}–{playerCell.y + 1}";

            switch (stage)
            {
                case JourneyStage.MeetLeni:
                    objectiveTitle.text = "LENI TREFFEN";
                    objectiveBody.text = "MENSCHLICHE LENI · Geh auf ihr Feld am unteren Bahnsteig und sprich dort mit ihr.";
                    interactionLabel.text = "MIT LENI SPRECHEN";
                    break;
                case JourneyStage.ReadMap:
                    objectiveTitle.text = "STRECKENKARTE LESEN";
                    objectiveBody.text = "Finde die goldene Streckenkarte. Nur direkt auf dem Feld kannst du sie lesen.";
                    interactionLabel.text = "STRECKENKARTE LESEN";
                    break;
                case JourneyStage.BoardTrain:
                    objectiveTitle.text = "BIRDIE EXPRESS BESTEIGEN";
                    objectiveBody.text = "Der Express wartet oben rechts. Geh bis zur Tür und steig ein.";
                    interactionLabel.text = "IN DEN EXPRESS EINSTEIGEN";
                    break;
                case JourneyStage.Traveling:
                    objectiveTitle.text = "BIRDIE EXPRESS";
                    objectiveBody.text = "Die Reise zum Nest läuft.";
                    interactionLabel.text = "UNTERWEGS";
                    break;
                default:
                    objectiveTitle.text = "ANGEKOMMEN";
                    objectiveBody.text = "The Nest · Vorplatz";
                    interactionLabel.text = "REISE GESCHAFFT";
                    break;
            }

            var activeStep = stage == JourneyStage.MeetLeni ? 0 : stage == JourneyStage.ReadMap ? 1 : 2;
            for (var i = 0; i < stepLabels.Length; i++)
            {
                var completed = i < activeStep || stage == JourneyStage.Traveling || stage == JourneyStage.Arrived;
                stepLabels[i].color = completed ? gold : i == activeStep ? ivory : quiet;
                var baseText = i == 0 ? "LENI TREFFEN" : i == 1 ? "STRECKENKARTE LESEN" : "BIRDIE EXPRESS BESTEIGEN";
                stepLabels[i].text = completed ? $"✓  {baseText}" : $"0{i + 1}  {baseText}";
            }

            var exactCell = CanMove() && playerCell == target;
            interactionButton.interactable = exactCell;
            interactionBackground.color = exactCell
                ? new Color(0.16f, 0.12f, 0.055f, 1f)
                : new Color(0.045f, 0.055f, 0.047f, 1f);
            interactionLabel.color = exactCell ? ivory : new Color(quiet.r, quiet.g, quiet.b, 0.62f);

            var movementEnabled = CanMove();
            foreach (var button in movementButtons) button.interactable = movementEnabled;
        }

        private Vector2Int ObjectiveCell()
        {
            return stage switch
            {
                JourneyStage.MeetLeni => LeniCell,
                JourneyStage.ReadMap => MapCell,
                JourneyStage.BoardTrain => TrainCell,
                _ => playerCell
            };
        }

        private void MovementButton(Transform parent, string label, Vector2 min, Vector2 max, int x, int y)
        {
            var go = MakeButton(parent, label, min, max, () => TryMove(x, y));
            var button = go.GetComponent<UnityEngine.UI.Button>();
            movementButtons.Add(button);
        }

        private GameObject MakeButton(Transform parent, string value, Vector2 min, Vector2 max, Action action)
        {
            var go = Panel(parent, value, min, max, new Color(0.08f, 0.12f, 0.09f, 1f));
            AddOutline(go, new Color(gold.r, gold.g, gold.b, 0.70f), 1f);
            var button = go.AddComponent<UnityEngine.UI.Button>();
            button.targetGraphic = go.GetComponent<Image>();
            button.navigation = new Navigation { mode = Navigation.Mode.None };
            button.onClick.AddListener(() => action?.Invoke());
            Label(go.transform, value, 17, ivory, TextAnchor.MiddleCenter, new Vector2(0.04f, 0.08f), new Vector2(0.96f, 0.92f));
            return go;
        }

        private void AnimatePlayerMarker()
        {
            if (playerMarker == null || !platformScreen.activeInHierarchy) return;
            markerTime += Time.unscaledDeltaTime;
            var scale = 1f + Mathf.Sin(markerTime * 3.2f) * 0.025f;
            playerMarker.localScale = new Vector3(scale, scale, 1f);
        }

        private void ApplyResponsiveLayout(bool force = false)
        {
            if (journeyRoot == null) return;
            if (!force && layoutWidth == UnityEngine.Screen.width && layoutHeight == UnityEngine.Screen.height) return;
            layoutWidth = UnityEngine.Screen.width;
            layoutHeight = UnityEngine.Screen.height;
            var portrait = layoutHeight > layoutWidth;

            if (portrait)
            {
                Stretch(headerLayout, new Vector2(0.04f, 0.87f), new Vector2(0.96f, 0.98f));
                Stretch(platformLayout, new Vector2(0.05f, 0.39f), new Vector2(0.95f, 0.84f));
                Stretch(guideLayout, new Vector2(0.05f, 0.17f), new Vector2(0.62f, 0.36f));
                Stretch(controlsLayout, new Vector2(0.65f, 0.17f), new Vector2(0.95f, 0.36f));
                Stretch(interactionLayout, new Vector2(0.05f, 0.055f), new Vector2(0.95f, 0.145f));
                feedbackLabel.rectTransform.anchorMin = new Vector2(0.05f, 0.005f);
                feedbackLabel.rectTransform.anchorMax = new Vector2(0.95f, 0.05f);
                travelCardLayout.anchorMin = new Vector2(0.05f, 0.16f);
                travelCardLayout.anchorMax = new Vector2(0.95f, 0.84f);
                arrivalCardLayout.anchorMin = new Vector2(0.05f, 0.14f);
                arrivalCardLayout.anchorMax = new Vector2(0.95f, 0.86f);
            }
            else
            {
                Stretch(headerLayout, new Vector2(0.03f, 0.86f), new Vector2(0.97f, 0.98f));
                Stretch(platformLayout, new Vector2(0.03f, 0.18f), new Vector2(0.70f, 0.84f));
                Stretch(guideLayout, new Vector2(0.73f, 0.42f), new Vector2(0.97f, 0.84f));
                Stretch(controlsLayout, new Vector2(0.73f, 0.18f), new Vector2(0.97f, 0.39f));
                Stretch(interactionLayout, new Vector2(0.73f, 0.06f), new Vector2(0.97f, 0.15f));
                feedbackLabel.rectTransform.anchorMin = new Vector2(0.03f, 0.07f);
                feedbackLabel.rectTransform.anchorMax = new Vector2(0.70f, 0.15f);
                travelCardLayout.anchorMin = new Vector2(0.12f, 0.12f);
                travelCardLayout.anchorMax = new Vector2(0.88f, 0.88f);
                arrivalCardLayout.anchorMin = new Vector2(0.18f, 0.12f);
                arrivalCardLayout.anchorMax = new Vector2(0.82f, 0.88f);
            }
            travelCardLayout.offsetMin = travelCardLayout.offsetMax = Vector2.zero;
            arrivalCardLayout.offsetMin = arrivalCardLayout.offsetMax = Vector2.zero;
        }

        private (RectTransform root, Image coat, Text label) CreateHumanFigure(
            Transform parent,
            string objectName,
            Vector2 min,
            Vector2 max,
            Color coatColor,
            string caption,
            bool includeCaption)
        {
            var root = new GameObject(objectName, typeof(RectTransform));
            root.transform.SetParent(parent, false);
            var rect = root.GetComponent<RectTransform>();
            Stretch(rect, min, max);
            Shape(root.transform, "LeftLeg", new Vector2(0.31f, includeCaption ? 0.20f : 0.05f), new Vector2(0.46f, 0.48f), ink);
            Shape(root.transform, "RightLeg", new Vector2(0.54f, includeCaption ? 0.20f : 0.05f), new Vector2(0.69f, 0.48f), ink);
            var coat = Shape(root.transform, "TravelCoat", new Vector2(0.20f, 0.40f), new Vector2(0.80f, 0.73f), coatColor);
            Shape(root.transform, "Head", new Vector2(0.34f, 0.68f), new Vector2(0.66f, 0.94f), new Color(0.80f, 0.62f, 0.47f, 1f));
            Shape(root.transform, "Hair", new Vector2(0.31f, 0.85f), new Vector2(0.69f, 0.97f), new Color(0.08f, 0.05f, 0.03f, 1f));
            var label = includeCaption
                ? Label(root.transform, caption, 10, ivory, TextAnchor.MiddleCenter, new Vector2(-0.20f, 0.00f), new Vector2(1.20f, 0.20f))
                : null;
            return (rect, coat, label);
        }

        private static void SetMarkerCell(RectTransform rect, Vector2Int cell, float inset = 0.12f)
        {
            if (rect == null) return;
            var cellMin = new Vector2(cell.x / 7f, cell.y / 5f);
            var cellMax = new Vector2((cell.x + 1f) / 7f, (cell.y + 1f) / 5f);
            var size = cellMax - cellMin;
            rect.anchorMin = cellMin + size * inset;
            rect.anchorMax = cellMax - size * inset;
            rect.offsetMin = rect.offsetMax = Vector2.zero;
        }

        private GameObject Panel(Transform parent, string name, Vector2 min, Vector2 max, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var image = go.GetComponent<Image>();
            image.color = color;
            return go;
        }

        private Image Shape(Transform parent, string name, Vector2 min, Vector2 max, Color color)
        {
            var go = Panel(parent, name, min, max, color);
            var image = go.GetComponent<Image>();
            image.raycastTarget = false;
            return image;
        }

        private Text Label(Transform parent, string value, int size, Color color, TextAnchor alignment, Vector2 min, Vector2 max)
        {
            var go = new GameObject("Text", typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var label = go.GetComponent<Text>();
            label.font = font;
            label.text = value;
            label.fontSize = size;
            label.color = color;
            label.alignment = alignment;
            label.resizeTextForBestFit = true;
            label.resizeTextMinSize = 8;
            label.resizeTextMaxSize = size;
            label.supportRichText = false;
            label.raycastTarget = false;
            return label;
        }

        private static void AddOutline(GameObject target, Color color, float distance)
        {
            var outline = target.AddComponent<Outline>();
            outline.effectColor = color;
            outline.effectDistance = new Vector2(distance, -distance);
        }

        private static void Stretch(RectTransform rect, Vector2 min, Vector2 max)
        {
            if (rect == null) return;
            rect.anchorMin = min;
            rect.anchorMax = max;
            rect.offsetMin = rect.offsetMax = Vector2.zero;
        }

        private static Color SignatureFor(string value)
        {
            return value switch
            {
                "midnight" => new Color(0.075f, 0.14f, 0.24f, 1f),
                "sand" => new Color(0.55f, 0.42f, 0.28f, 1f),
                "burgundy" => new Color(0.35f, 0.07f, 0.08f, 1f),
                _ => new Color(0.035f, 0.22f, 0.14f, 1f)
            };
        }

        private static string StoryFor(string value)
        {
            return value switch
            {
                "strategist" => "STRATEG:IN",
                "connoisseur" => "GENIESSER:IN",
                "builder" => "MACHER:IN",
                _ => "ENTDECKER:IN"
            };
        }
    }
}
