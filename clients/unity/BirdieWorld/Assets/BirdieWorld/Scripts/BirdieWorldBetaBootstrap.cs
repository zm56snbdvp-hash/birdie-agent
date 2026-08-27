using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace BirdieWorld
{
    public sealed class BirdieWorldBetaBootstrap : MonoBehaviour
    {
        private readonly Color ink = new(0.018f, 0.035f, 0.031f, 1f);
        private readonly Color panel = new(0.025f, 0.075f, 0.058f, 0.96f);
        private readonly Color forest = new(0.035f, 0.18f, 0.12f, 1f);
        private readonly Color gold = new(0.83f, 0.61f, 0.25f, 1f);
        private readonly Color ivory = new(0.95f, 0.92f, 0.83f, 1f);

        private Font font;
        private Canvas canvas;
        private GameObject startScreen;
        private GameObject creatorScreen;
        private GameObject readyScreen;
        private GameObject journeyScreen;
        private RectTransform startVisualLayout;
        private RectTransform startMenuLayout;
        private RectTransform creatorPreviewLayout;
        private RectTransform creatorFormLayout;
        private RectTransform readyCardLayout;
        private InputField nameField;
        private Text statusText;
        private Text readyNameText;
        private Text readyStatusText;
        private UnityEngine.UI.Button saveButton;
        private CanvasGroup creatorInteraction;
        private CharacterProfile profile;
        private CharacterStore store;
        private BirdieWorldCharacterPersistence persistence;
        private BirdieWorldAuthSession authSession;
        private BirdieWorldAvatarPreview avatarPreview;
        private BirdieWorldFirstJourney firstJourney;
        private readonly Dictionary<string, GameObject> storyChoices = new();
        private readonly Dictionary<string, GameObject> colorChoices = new();
        private CharacterProfile pendingUnboundDraft;
        private bool pendingUnboundDraftReady;
        private bool profileIsAccountScoped;
        private bool accountProfileReady;
        private bool profileReadyForJourney;
        private int profileRevision;
        private int layoutWidth;
        private int layoutHeight;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void EnsureBootstrap()
        {
            if (FindFirstObjectByType<BirdieWorldBetaBootstrap>() != null) return;
            new GameObject("BirdieWorld Beta").AddComponent<BirdieWorldBetaBootstrap>();
        }

        private void Awake()
        {
            DontDestroyOnLoad(gameObject);
            store = new CharacterStore();
            profile = store.LoadOrCreate();
            profileReadyForJourney = HasValidProfileName();
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            BuildServices();
            BuildEventSystem();
            BuildCanvas();
            BuildStartScreen();
            BuildCreatorScreen();
            BuildReadyScreen();
            BuildFirstJourney();
            ApplyResponsiveLayout(true);
            Show(startScreen);
            BuildCinematicOpener();
        }

        private void Update()
        {
            ApplyResponsiveLayout();
        }

        private void OnDestroy()
        {
            if (authSession == null) return;
            authSession.Configured -= HandleAuthenticatedSession;
            authSession.Refreshed -= HandleSessionRefreshed;
            authSession.ConfigurationFailed -= HandleSessionFailure;
            authSession.Cleared -= HandleSessionCleared;
        }

        private void BuildServices()
        {
            var services = new GameObject("BirdieWorld Auth Session");
            services.transform.SetParent(transform, false);
            var characterApi = services.AddComponent<BirdieWorldCharacterApi>();
            persistence = services.AddComponent<BirdieWorldCharacterPersistence>();
            persistence.Initialize(characterApi);
            authSession = services.AddComponent<BirdieWorldAuthSession>();
            authSession.Initialize(characterApi);
            authSession.Configured += HandleAuthenticatedSession;
            authSession.Refreshed += HandleSessionRefreshed;
            authSession.ConfigurationFailed += HandleSessionFailure;
            authSession.Cleared += HandleSessionCleared;
        }

        private void BuildEventSystem()
        {
            if (FindFirstObjectByType<EventSystem>() != null) return;
            var go = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            DontDestroyOnLoad(go);
        }

        private void BuildCanvas()
        {
            var go = new GameObject("BirdieWorld UI", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvas = go.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600, 900);
            scaler.matchWidthOrHeight = 0.5f;
            DontDestroyOnLoad(go);
        }

        private void BuildCinematicOpener()
        {
            gameObject.AddComponent<BirdieWorldCinematicOpener>()
                .Build(canvas.transform, () => Show(startScreen));
        }

        private void BuildStartScreen()
        {
            startScreen = Fullscreen("Start", ink);

            var visual = Panel(startScreen.transform, "JourneyVisual", new Vector2(0f, 0f), new Vector2(0.58f, 1f), forest);
            startVisualLayout = visual.GetComponent<RectTransform>();
            BirdieWorldArt.Cover(visual.transform, "ExpressHeroArt", "BirdieWorldArt/express-hero", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(visual.transform, "JourneyVisualTint", Vector2.zero, Vector2.one, new Color(0.004f, 0.015f, 0.011f, 0.38f));
            Label(visual.transform, "B", 56, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.78f), new Vector2(0.22f, 0.94f));
            Label(visual.transform, "BIRDIE & BREAKFAST", 45, gold, TextAnchor.MiddleCenter, new Vector2(0.15f, 0.63f), new Vector2(0.92f, 0.78f));
            Label(visual.transform, "DEINE WELT. DEIN BIRDIE. DEIN ABENTEUER.", 20, ivory, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.57f), new Vector2(0.94f, 0.64f));
            Label(visual.transform,
                "BIRDIE EXPRESS\n\nTief durch die Täler. Hoch über die Berge.\nMit Leni auf dem Weg zu Coin Shop, The Nest und allem, was noch kommt.",
                23, ivory, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.27f), new Vector2(0.90f, 0.54f));

            var menu = Panel(startScreen.transform, "Menu", new Vector2(0.58f, 0f), Vector2.one, panel);
            startMenuLayout = menu.GetComponent<RectTransform>();
            Label(menu.transform, "BIRDIEWORLD", 52, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.72f), new Vector2(0.92f, 0.89f));
            Label(menu.transform, "BETA · DEIN ERSTER SCHRITT IN DIE WELT", 18, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.66f), new Vector2(0.92f, 0.73f));
            Button(menu.transform, "REISE BEGINNEN", "Steig ein und entdecke die Welt", new Vector2(0.12f, 0.46f), new Vector2(0.88f, 0.61f), ResumeJourneyOrCreate);
            Button(menu.transform, "BIRDIE ERSTELLEN", "Deinen Charakter erschaffen", new Vector2(0.12f, 0.28f), new Vector2(0.88f, 0.43f), () => Show(creatorScreen));
            Label(menu.transform, "BETA 02 · ERSTE REISE", 16, gold, TextAnchor.MiddleCenter, new Vector2(0.15f, 0.10f), new Vector2(0.85f, 0.18f));
        }

        private void BuildCreatorScreen()
        {
            creatorScreen = Fullscreen("Creator", ink);
            creatorInteraction = creatorScreen.AddComponent<CanvasGroup>();
            var preview = Panel(creatorScreen.transform, "Preview", Vector2.zero, new Vector2(0.48f, 1f), forest);
            creatorPreviewLayout = preview.GetComponent<RectTransform>();
            Label(preview.transform, "BIRDIE EXPRESS · CHARACTER CABIN", 18, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.84f), new Vector2(0.92f, 0.92f));
            Label(preview.transform, "DEIN BIRDIE", 48, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.66f), new Vector2(0.92f, 0.82f));
            avatarPreview = preview.AddComponent<BirdieWorldAvatarPreview>();
            avatarPreview.Build(preview.transform, font);
            Label(preview.transform, "DEIN LOOK REAGIERT DIREKT AUF DEINE AUSWAHL.", 14, ivory, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.055f), new Vector2(0.90f, 0.11f));

            var form = Panel(creatorScreen.transform, "Form", new Vector2(0.48f, 0f), Vector2.one, panel);
            creatorFormLayout = form.GetComponent<RectTransform>();
            Label(form.transform, "BIRDIE ERSTELLEN", 34, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.88f), new Vector2(0.92f, 0.97f));
            Label(form.transform, "1  CHARAKTER        2  ANPASSEN        3  BESTÄTIGEN", 17, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.82f), new Vector2(0.92f, 0.88f));
            Label(form.transform, "WER BIST DU?", 29, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.72f), new Vector2(0.92f, 0.80f));

            nameField = Input(form.transform, new Vector2(0.08f, 0.64f), new Vector2(0.92f, 0.72f), "Dein Name...");
            nameField.characterLimit = 40;
            nameField.text = profile.displayName ?? string.Empty;
            nameField.onValueChanged.AddListener(value =>
            {
                profile.displayName = value;
                profileReadyForJourney = false;
                profileRevision++;
                RefreshCreatorPreview();
            });

            Label(form.transform, "WÄHLE DEINE STORY", 17, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.57f), new Vector2(0.92f, 0.63f));
            Choice(form.transform, "DIE ENTDECKER:IN", "explorer", new Vector2(0.08f, 0.49f), new Vector2(0.92f, 0.57f));
            Choice(form.transform, "DIE STRATEG:IN", "strategist", new Vector2(0.08f, 0.40f), new Vector2(0.92f, 0.48f));
            Choice(form.transform, "DIE GENIESSER:IN", "connoisseur", new Vector2(0.08f, 0.31f), new Vector2(0.92f, 0.39f));

            Label(form.transform, "WÄHLE DEINE FARBE", 17, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.24f), new Vector2(0.92f, 0.30f));
            ColorChoice(form.transform, "FOREST", "forest", forest, 0.08f);
            ColorChoice(form.transform, "MIDNIGHT", "midnight", new Color(0.05f, 0.10f, 0.20f), 0.29f);
            ColorChoice(form.transform, "SAND", "sand", new Color(0.55f, 0.42f, 0.28f), 0.50f);
            ColorChoice(form.transform, "BURGUNDY", "burgundy", new Color(0.30f, 0.06f, 0.07f), 0.71f);

            saveButton = Button(form.transform, "WEITER", "Charakter speichern", new Vector2(0.52f, 0.06f), new Vector2(0.92f, 0.16f), SaveProfile).GetComponent<UnityEngine.UI.Button>();
            Button(form.transform, "ZURÜCK", string.Empty, new Vector2(0.08f, 0.06f), new Vector2(0.34f, 0.16f), () => Show(startScreen));
            statusText = Label(form.transform, string.Empty, 15, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.005f), new Vector2(0.92f, 0.055f));
            RefreshCreatorPreview();
        }

        private void BuildReadyScreen()
        {
            readyScreen = Fullscreen("Ready", ink);
            BirdieWorldArt.Cover(readyScreen.transform, "NestForecourtArt", "BirdieWorldArt/nest-forecourt", Vector2.zero, Vector2.one, Color.white);
            BirdieWorldArt.Tint(readyScreen.transform, "ReadyAtmosphere", Vector2.zero, Vector2.one, new Color(0.004f, 0.015f, 0.011f, 0.30f));
            var card = Panel(readyScreen.transform, "ReadyCard", new Vector2(0.18f, 0.13f), new Vector2(0.82f, 0.87f), new Color(panel.r, panel.g, panel.b, 0.92f));
            readyCardLayout = card.GetComponent<RectTransform>();
            card.AddComponent<Outline>().effectColor = gold;
            Label(card.transform, "BIRDIE EXPRESS · ANKUNFT", 18, gold, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.82f), new Vector2(0.90f, 0.90f));
            Label(card.transform, "DEIN BIRDIE IST BEREIT.", 44, ivory, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.62f), new Vector2(0.90f, 0.80f));
            readyNameText = Label(card.transform, string.Empty, 30, gold, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.48f), new Vector2(0.88f, 0.60f));
            readyStatusText = Label(card.transform, string.Empty, 19, ivory, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.31f), new Vector2(0.88f, 0.46f));
            Button(card.transform, "BIRDIE ANPASSEN", string.Empty, new Vector2(0.10f, 0.12f), new Vector2(0.44f, 0.23f), () => Show(creatorScreen));
            Button(card.transform, "ERSTE REISE STARTEN", string.Empty, new Vector2(0.56f, 0.12f), new Vector2(0.90f, 0.23f), BeginFirstJourney);
        }

        private void BuildFirstJourney()
        {
            firstJourney = gameObject.AddComponent<BirdieWorldFirstJourney>();
            firstJourney.Build(canvas.transform, font, () => Show(startScreen));
            journeyScreen = firstJourney.Screen;
        }

        private void ResumeJourneyOrCreate()
        {
            if (!HasReadyProfile())
            {
                Show(creatorScreen);
                if (statusText != null && HasValidProfileName())
                    statusText.text = "Speichere deine aktuelle Auswahl zuerst mit WEITER.";
                return;
            }

            BeginFirstJourney();
        }

        private void BeginFirstJourney()
        {
            if (profileIsAccountScoped && !accountProfileReady)
            {
                Show(creatorScreen);
                if (statusText != null)
                    statusText.text = "Dein Konto-Birdie wird noch geladen · danach kann die Reise beginnen.";
                return;
            }

            if (!HasReadyProfile())
            {
                Show(creatorScreen);
                if (statusText != null)
                    statusText.text = HasValidProfileName()
                        ? "Speichere deine aktuelle Auswahl zuerst mit WEITER."
                        : "Erstelle zuerst dein Birdie, bevor die Reise beginnt.";
                return;
            }

            // The journey receives a snapshot so it can never mutate the persisted profile.
            var readOnlyProfile = CharacterProfile.FromJson(profile.ToJson());
            Show(journeyScreen);
            firstJourney.Enter(readOnlyProfile);
        }

        private bool HasValidProfileName()
        {
            var name = profile?.displayName?.Trim();
            return !string.IsNullOrEmpty(name) && name.Length >= 2 && name.Length <= 40;
        }

        private bool HasReadyProfile()
        {
            return profileReadyForJourney && HasValidProfileName();
        }

        private void HandleAuthenticatedSession()
        {
            firstJourney?.ResetJourney();
            persistence.CancelPendingRequests();
            if (!profileIsAccountScoped && pendingUnboundDraft == null)
            {
                pendingUnboundDraft = profile;
                pendingUnboundDraftReady = profileReadyForJourney;
            }
            else if (profileIsAccountScoped && pendingUnboundDraft == null)
            {
                store.Clear();
                pendingUnboundDraftReady = false;
            }

            profile = CharacterProfile.CreateDefault();
            profileIsAccountScoped = true;
            accountProfileReady = false;
            profileReadyForJourney = false;
            nameField.SetTextWithoutNotify(string.Empty);
            profileRevision++;
            Show(startScreen);

            var sessionGeneration = authSession.Generation;
            var revisionAtLoad = profileRevision;
            SetBusy(true, "Birdie-Konto verbunden · Profil wird geladen …");
            persistence.LoadServerProfile(
                serverProfile =>
                {
                    if (sessionGeneration != authSession.Generation) return;
                    accountProfileReady = true;
                    pendingUnboundDraft = null;
                    pendingUnboundDraftReady = false;
                    store.Clear();
                    if (serverProfile != null && revisionAtLoad == profileRevision)
                    {
                        BirdieWorldCharacterMapper.ApplyServerProfile(profile, serverProfile);
                        profileReadyForJourney = HasValidProfileName();
                        nameField.SetTextWithoutNotify(profile.displayName ?? string.Empty);
                        RefreshCreatorPreview();
                        profileRevision++;
                        statusText.text = "✓ Dein Konto-Birdie wurde geladen.";
                    }
                    else if (serverProfile == null && revisionAtLoad == profileRevision)
                    {
                        profileReadyForJourney = false;
                        nameField.SetTextWithoutNotify(string.Empty);
                        RefreshCreatorPreview();
                        profileRevision++;
                        statusText.text = "Konto verbunden · für dieses Konto erstellst du jetzt ein neues Birdie.";
                    }
                    else
                    {
                        profileReadyForJourney = false;
                        statusText.text = "Konto verbunden · deine aktuelle Auswahl bleibt erhalten.";
                    }
                    SetBusy(false);
                },
                _ =>
                {
                    if (sessionGeneration != authSession.Generation) return;
                    accountProfileReady = false;
                    if (pendingUnboundDraft != null)
                    {
                        profile = pendingUnboundDraft;
                        pendingUnboundDraft = null;
                        profileIsAccountScoped = false;
                        profileReadyForJourney = pendingUnboundDraftReady;
                        pendingUnboundDraftReady = false;
                        nameField.SetTextWithoutNotify(profile.displayName ?? string.Empty);
                        RefreshCreatorPreview();
                        profileRevision++;
                        SetBusy(false, "Kontosynchronisierung nicht erreichbar · dein unangemeldeter Entwurf bleibt lokal.");
                    }
                    else
                    {
                        SetBusy(false, "Kontosynchronisierung nicht erreichbar · Kontodaten bleiben bis zur Bestätigung verborgen.");
                    }
                });
        }

        private void HandleSessionRefreshed()
        {
            if (!accountProfileReady)
            {
                HandleAuthenticatedSession();
                return;
            }
            if (statusText != null) statusText.text = "✓ Birdie-Sitzung sicher erneuert.";
        }

        private void HandleSessionFailure(string _)
        {
            var journeyWasActive = journeyScreen != null && journeyScreen.activeSelf;
            firstJourney?.ResetJourney();
            persistence.CancelPendingRequests();
            accountProfileReady = false;
            if (profileIsAccountScoped)
            {
                if (pendingUnboundDraft != null)
                {
                    profile = pendingUnboundDraft;
                    pendingUnboundDraft = null;
                    profileIsAccountScoped = false;
                    profileReadyForJourney = pendingUnboundDraftReady;
                    pendingUnboundDraftReady = false;
                    nameField.SetTextWithoutNotify(profile.displayName ?? string.Empty);
                    RefreshCreatorPreview();
                }
                else
                {
                    store.Clear();
                    profile = CharacterProfile.CreateDefault();
                    profileReadyForJourney = false;
                    nameField.SetTextWithoutNotify(string.Empty);
                    RefreshCreatorPreview();
                }
                profileRevision++;
                Show(startScreen);
            }
            else if (journeyWasActive)
            {
                Show(startScreen);
            }
            SetBusy(false, "Anmeldung konnte nicht übernommen werden · lokaler Modus bleibt aktiv.");
        }

        private void HandleSessionCleared()
        {
            firstJourney?.ResetJourney();
            persistence.CancelPendingRequests();
            pendingUnboundDraft = null;
            pendingUnboundDraftReady = false;
            profileIsAccountScoped = false;
            accountProfileReady = false;
            profileReadyForJourney = false;
            store.Clear();
            profile = CharacterProfile.CreateDefault();
            nameField.SetTextWithoutNotify(string.Empty);
            RefreshCreatorPreview();
            profileRevision++;
            SetBusy(false, "Birdie-Konto getrennt · lokaler Modus ist aktiv.");
            Show(startScreen);
        }

        private void SaveProfile()
        {
            var name = nameField.text.Trim();
            if (name.Length < 2 || name.Length > 40)
            {
                statusText.text = "Bitte gib deinem Birdie einen Namen mit 2 bis 40 Zeichen.";
                return;
            }

            profile.displayName = name;
            profileRevision++;
            profileReadyForJourney = false;
            var revisionAtSave = profileRevision;

            if (!profileIsAccountScoped)
            {
                store.Save(profile);
                profileReadyForJourney = true;
                ShowReady("Auf diesem Gerät gespeichert. Mit deiner Birdie-Anmeldung folgt der Geräte-Sync.");
                return;
            }

            if (!persistence.IsServerConfigured || !accountProfileReady)
            {
                SetBusy(false, "Dein Konto-Birdie ist noch nicht speicherbereit · bitte versuche es gleich erneut.");
                return;
            }

            SetBusy(true, "Dein Birdie wird sicher mit deinem Konto synchronisiert …");
            var sessionGeneration = authSession.Generation;
            persistence.SaveServerProfile(
                BirdieWorldCharacterMapper.ToServerWrite(profile),
                serverProfile =>
                {
                    if (sessionGeneration != authSession.Generation) return;
                    if (revisionAtSave != profileRevision)
                    {
                        SetBusy(false, "Deine neuere Auswahl bleibt erhalten · bitte speichere sie noch einmal.");
                        return;
                    }
                    BirdieWorldCharacterMapper.ApplyServerProfile(profile, serverProfile);
                    profileIsAccountScoped = true;
                    accountProfileReady = true;
                    profileReadyForJourney = true;
                    store.Clear();
                    nameField.SetTextWithoutNotify(profile.displayName ?? string.Empty);
                    RefreshCreatorPreview();
                    profileRevision++;
                    SetBusy(false);
                    ShowReady("Mit deinem Birdie-Konto synchronisiert und auf deinen Geräten verfügbar.");
                },
                _ =>
                {
                    if (sessionGeneration != authSession.Generation) return;
                    profileReadyForJourney = false;
                    SetBusy(false, "Dein Konto-Birdie wurde nicht gespeichert · bitte versuche es erneut.");
                });
        }

        private void ShowReady(string synchronizationStatus)
        {
            readyNameText.text = (profile.displayName ?? "DEIN BIRDIE").ToUpperInvariant();
            readyStatusText.text = synchronizationStatus;
            Show(readyScreen);
        }

        private void SetBusy(bool busy, string message = null)
        {
            if (saveButton != null) saveButton.interactable = !busy;
            if (creatorInteraction != null) creatorInteraction.interactable = !busy;
            if (!string.IsNullOrWhiteSpace(message) && statusText != null) statusText.text = message;
        }

        private void Choice(Transform parent, string title, string value, Vector2 min, Vector2 max)
        {
            var choice = Button(parent, title, string.Empty, min, max, () =>
            {
                profile.story = value;
                profileReadyForJourney = false;
                profileRevision++;
                statusText.text = $"Story gewählt: {title}";
                RefreshCreatorPreview();
            });
            storyChoices[value] = choice;
        }

        private void ColorChoice(Transform parent, string title, string value, Color color, float x)
        {
            var choice = Button(parent, title, string.Empty, new Vector2(x, 0.17f), new Vector2(x + 0.18f, 0.235f), () =>
            {
                profile.color = value;
                profileReadyForJourney = false;
                profileRevision++;
                statusText.text = $"Farbe gewählt: {title}";
                RefreshCreatorPreview();
            });
            choice.GetComponent<Image>().color = Color.Lerp(color, panel, 0.25f);
            colorChoices[value] = choice;
        }

        private void RefreshCreatorPreview()
        {
            avatarPreview?.Apply(profile, nameField?.text);
            RefreshChoiceStates(storyChoices, profile?.story);
            RefreshChoiceStates(colorChoices, profile?.color);
        }

        private void RefreshChoiceStates(Dictionary<string, GameObject> choices, string selectedValue)
        {
            foreach (var entry in choices)
            {
                var selected = string.Equals(entry.Key, selectedValue, StringComparison.OrdinalIgnoreCase);
                var outline = entry.Value.GetComponent<Outline>() ?? entry.Value.AddComponent<Outline>();
                outline.effectColor = selected ? gold : new Color(gold.r, gold.g, gold.b, 0.25f);
                outline.effectDistance = selected ? new Vector2(3f, -3f) : new Vector2(1f, -1f);
                var label = entry.Value.GetComponentInChildren<Text>();
                if (label != null) label.color = selected ? ivory : gold;
            }
        }

        private void ApplyResponsiveLayout(bool force = false)
        {
            if (!force && layoutWidth == Screen.width && layoutHeight == Screen.height) return;
            layoutWidth = Screen.width;
            layoutHeight = Screen.height;
            var portrait = layoutHeight > layoutWidth;

            if (portrait)
            {
                Stretch(startVisualLayout, new Vector2(0f, 0.52f), Vector2.one);
                Stretch(startMenuLayout, Vector2.zero, new Vector2(1f, 0.52f));
                Stretch(creatorPreviewLayout, new Vector2(0f, 0.58f), Vector2.one);
                Stretch(creatorFormLayout, Vector2.zero, new Vector2(1f, 0.58f));
                Stretch(readyCardLayout, new Vector2(0.07f, 0.12f), new Vector2(0.93f, 0.88f));
            }
            else
            {
                Stretch(startVisualLayout, Vector2.zero, new Vector2(0.58f, 1f));
                Stretch(startMenuLayout, new Vector2(0.58f, 0f), Vector2.one);
                Stretch(creatorPreviewLayout, Vector2.zero, new Vector2(0.48f, 1f));
                Stretch(creatorFormLayout, new Vector2(0.48f, 0f), Vector2.one);
                Stretch(readyCardLayout, new Vector2(0.18f, 0.13f), new Vector2(0.82f, 0.87f));
            }
        }

        private GameObject Fullscreen(string name, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(canvas.transform, false);
            Stretch(go.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
            go.GetComponent<Image>().color = color;
            return go;
        }

        private GameObject Panel(Transform parent, string name, Vector2 min, Vector2 max, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = color;
            return go;
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
            text.supportRichText = false;
            text.resizeTextMinSize = 10;
            text.resizeTextMaxSize = size;
            return text;
        }

        private GameObject Button(Transform parent, string title, string subtitle, Vector2 min, Vector2 max, Action action)
        {
            var go = new GameObject(title, typeof(RectTransform), typeof(Image), typeof(UnityEngine.UI.Button));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = new Color(0.04f, 0.12f, 0.09f, 1f);
            var button = go.GetComponent<UnityEngine.UI.Button>();
            button.onClick.AddListener(() => action());
            Label(go.transform, string.IsNullOrEmpty(subtitle) ? title : $"{title}\n{subtitle}", 22, gold, TextAnchor.MiddleCenter, new Vector2(0.03f, 0.05f), new Vector2(0.97f, 0.95f));
            return go;
        }

        private InputField Input(Transform parent, Vector2 min, Vector2 max, string placeholder)
        {
            var go = new GameObject("NameInput", typeof(RectTransform), typeof(Image), typeof(InputField));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = new Color(0.01f, 0.035f, 0.028f, 1f);
            var field = go.GetComponent<InputField>();
            var text = Label(go.transform, string.Empty, 21, ivory, TextAnchor.MiddleLeft, new Vector2(0.04f, 0.08f), new Vector2(0.96f, 0.92f));
            var hint = Label(go.transform, placeholder, 19, new Color(ivory.r, ivory.g, ivory.b, 0.45f), TextAnchor.MiddleLeft, new Vector2(0.04f, 0.08f), new Vector2(0.96f, 0.92f));
            field.textComponent = text;
            field.placeholder = hint;
            return field;
        }

        private static void Stretch(RectTransform rt, Vector2 min, Vector2 max)
        {
            if (rt == null) return;
            rt.anchorMin = min;
            rt.anchorMax = max;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }

        private void Show(GameObject target)
        {
            if (startScreen != null) startScreen.SetActive(target == startScreen);
            if (creatorScreen != null) creatorScreen.SetActive(target == creatorScreen);
            if (readyScreen != null) readyScreen.SetActive(target == readyScreen);
            if (journeyScreen != null) journeyScreen.SetActive(target == journeyScreen);
        }
    }
}
