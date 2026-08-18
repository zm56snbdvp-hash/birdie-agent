using System;
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
        private InputField nameField;
        private Text statusText;
        private CharacterProfile profile;
        private CharacterStore store;

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
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            BuildEventSystem();
            BuildCanvas();
            BuildStartScreen();
            BuildCreatorScreen();
            Show(startScreen);
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

        private void BuildStartScreen()
        {
            startScreen = Fullscreen("Start", ink);

            var visual = Panel(startScreen.transform, "JourneyVisual", new Vector2(0f, 0f), new Vector2(0.58f, 1f), forest);
            Label(visual.transform, "B", 56, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.78f), new Vector2(0.22f, 0.94f));
            Label(visual.transform, "BIRDIE & BREAKFAST", 45, gold, TextAnchor.MiddleCenter, new Vector2(0.15f, 0.63f), new Vector2(0.92f, 0.78f));
            Label(visual.transform, "DEINE WELT. DEIN BIRDIE. DEIN ABENTEUER.", 20, ivory, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.57f), new Vector2(0.94f, 0.64f));
            Label(visual.transform,
                "BIRDIE EXPRESS\n\nTief durch die Täler. Hoch über die Berge.\nMit Leni auf dem Weg zu Coin Shop, The Nest und allem, was noch kommt.",
                23, ivory, TextAnchor.MiddleCenter, new Vector2(0.10f, 0.27f), new Vector2(0.90f, 0.54f));

            var menu = Panel(startScreen.transform, "Menu", new Vector2(0.58f, 0f), Vector2.one, panel);
            Label(menu.transform, "BIRDIEWORLD", 52, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.72f), new Vector2(0.92f, 0.89f));
            Label(menu.transform, "BETA · DEIN ERSTER SCHRITT IN DIE WELT", 18, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.66f), new Vector2(0.92f, 0.73f));
            Button(menu.transform, "REISE BEGINNEN", "Steig ein und entdecke die Welt", new Vector2(0.12f, 0.46f), new Vector2(0.88f, 0.61f), () => Show(creatorScreen));
            Button(menu.transform, "BIRDIE ERSTELLEN", "Deinen Charakter erschaffen", new Vector2(0.12f, 0.28f), new Vector2(0.88f, 0.43f), () => Show(creatorScreen));
            Label(menu.transform, "BETA 01 · CHARACTER CREATION", 16, gold, TextAnchor.MiddleCenter, new Vector2(0.15f, 0.10f), new Vector2(0.85f, 0.18f));
        }

        private void BuildCreatorScreen()
        {
            creatorScreen = Fullscreen("Creator", ink);
            var preview = Panel(creatorScreen.transform, "Preview", Vector2.zero, new Vector2(0.48f, 1f), forest);
            Label(preview.transform, "BIRDIE EXPRESS · CHARACTER CABIN", 18, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.84f), new Vector2(0.92f, 0.92f));
            Label(preview.transform, "DEIN BIRDIE", 48, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.66f), new Vector2(0.92f, 0.82f));
            Label(preview.transform, "3D CHARACTER PREVIEW\n\nDer Avatar-Renderer kommt als nächster Asset-Layer.\nProfil, Auswahl und Speicherung funktionieren bereits.", 22, ivory, TextAnchor.MiddleCenter, new Vector2(0.12f, 0.34f), new Vector2(0.88f, 0.65f));

            var form = Panel(creatorScreen.transform, "Form", new Vector2(0.48f, 0f), Vector2.one, panel);
            Label(form.transform, "BIRDIE ERSTELLEN", 34, gold, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.88f), new Vector2(0.92f, 0.97f));
            Label(form.transform, "1  CHARAKTER        2  ANPASSEN        3  BESTÄTIGEN", 17, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.82f), new Vector2(0.92f, 0.88f));
            Label(form.transform, "WER BIST DU?", 29, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.72f), new Vector2(0.92f, 0.80f));

            nameField = Input(form.transform, new Vector2(0.08f, 0.64f), new Vector2(0.92f, 0.72f), "Dein Name...");
            nameField.text = profile.displayName ?? string.Empty;

            Label(form.transform, "WÄHLE DEINE STORY", 17, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.57f), new Vector2(0.92f, 0.63f));
            Choice(form.transform, "DIE ENTDECKER:IN", "explorer", new Vector2(0.08f, 0.49f), new Vector2(0.92f, 0.57f));
            Choice(form.transform, "DIE STRATEG:IN", "strategist", new Vector2(0.08f, 0.40f), new Vector2(0.92f, 0.48f));
            Choice(form.transform, "DIE GENIESSER:IN", "connoisseur", new Vector2(0.08f, 0.31f), new Vector2(0.92f, 0.39f));

            Label(form.transform, "WÄHLE DEINE FARBE", 17, gold, TextAnchor.MiddleLeft, new Vector2(0.08f, 0.24f), new Vector2(0.92f, 0.30f));
            ColorChoice(form.transform, "FOREST", "forest", forest, 0.08f);
            ColorChoice(form.transform, "MIDNIGHT", "midnight", new Color(0.05f, 0.10f, 0.20f), 0.29f);
            ColorChoice(form.transform, "SAND", "sand", new Color(0.55f, 0.42f, 0.28f), 0.50f);
            ColorChoice(form.transform, "BURGUNDY", "burgundy", new Color(0.30f, 0.06f, 0.07f), 0.71f);

            Button(form.transform, "WEITER", "Charakter speichern", new Vector2(0.52f, 0.06f), new Vector2(0.92f, 0.16f), SaveProfile);
            Button(form.transform, "ZURÜCK", "", new Vector2(0.08f, 0.06f), new Vector2(0.34f, 0.16f), () => Show(startScreen));
            statusText = Label(form.transform, string.Empty, 15, ivory, TextAnchor.MiddleCenter, new Vector2(0.08f, 0.005f), new Vector2(0.92f, 0.055f));
        }

        private void SaveProfile()
        {
            var name = nameField.text.Trim();
            if (name.Length < 2)
            {
                statusText.text = "Bitte gib deinem Birdie einen Namen.";
                return;
            }
            profile.displayName = name;
            store.Save(profile);
            statusText.text = "✓ Dein Birdie ist bereit. Willkommen an Bord.";
        }

        private void Choice(Transform parent, string title, string value, Vector2 min, Vector2 max)
        {
            Button(parent, title, string.Empty, min, max, () => { profile.story = value; statusText.text = $"Story gewählt: {title}"; });
        }

        private void ColorChoice(Transform parent, string title, string value, Color color, float x)
        {
            var b = Button(parent, title, string.Empty, new Vector2(x, 0.17f), new Vector2(x + 0.18f, 0.235f), () => { profile.color = value; statusText.text = $"Farbe gewählt: {title}"; });
            b.GetComponent<Image>().color = Color.Lerp(color, panel, 0.25f);
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
            text.resizeTextMinSize = 10;
            text.resizeTextMaxSize = size;
            return text;
        }

        private GameObject Button(Transform parent, string title, string subtitle, Vector2 min, Vector2 max, Action action)
        {
            var go = new GameObject(title, typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = new Color(0.04f, 0.12f, 0.09f, 1f);
            var button = go.GetComponent<Button>();
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
            rt.anchorMin = min;
            rt.anchorMax = max;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }

        private void Show(GameObject target)
        {
            if (startScreen != null) startScreen.SetActive(target == startScreen);
            if (creatorScreen != null) creatorScreen.SetActive(target == creatorScreen);
        }
    }
}
