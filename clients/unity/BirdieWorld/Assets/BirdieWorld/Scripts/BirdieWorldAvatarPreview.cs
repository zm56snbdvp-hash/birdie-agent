using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    public sealed class BirdieWorldAvatarPreview : MonoBehaviour
    {
        private readonly Color ink = new(0.012f, 0.025f, 0.021f, 1f);
        private readonly Color brass = new(0.83f, 0.61f, 0.25f, 1f);
        private readonly Color ivory = new(0.95f, 0.92f, 0.83f, 1f);

        private Image aura;
        private Image coat;
        private Image shirt;
        private Image scarf;
        private Image hair;
        private RawImage portraitArt;
        private Text monogram;
        private Text nameLabel;
        private Text storyLabel;
        private RectTransform figure;
        private float animationTime;

        public void Build(Transform parent, Font font)
        {
            var root = Panel(parent, "HumanAvatarPreview", new Vector2(0.09f, 0.14f), new Vector2(0.91f, 0.70f), new Color(0.008f, 0.024f, 0.019f, 0.92f));
            var frame = root.AddComponent<Outline>();
            frame.effectColor = new Color(brass.r, brass.g, brass.b, 0.55f);
            frame.effectDistance = new Vector2(2f, -2f);

            portraitArt = BirdieWorldArt.Cover(root.transform, "HumanAvatarArt", "BirdieWorldArt/avatar-human", new Vector2(0.12f, 0.06f), new Vector2(0.88f, 0.92f), Color.white);
            aura = Shape(root.transform, "SignatureAura", new Vector2(0.23f, 0.07f), new Vector2(0.77f, 0.88f), brass, true);
            aura.color = new Color(brass.r, brass.g, brass.b, 0.13f);

            var figureRoot = new GameObject("HumanFigure", typeof(RectTransform));
            figureRoot.transform.SetParent(root.transform, false);
            figure = figureRoot.GetComponent<RectTransform>();
            Stretch(figure, new Vector2(0.24f, 0.12f), new Vector2(0.76f, 0.92f));

            Shape(figure, "LeftLeg", new Vector2(0.34f, 0.00f), new Vector2(0.48f, 0.33f), new Color(0.035f, 0.055f, 0.05f, 1f));
            Shape(figure, "RightLeg", new Vector2(0.52f, 0.00f), new Vector2(0.66f, 0.33f), new Color(0.035f, 0.055f, 0.05f, 1f));
            Shape(figure, "LeftShoe", new Vector2(0.26f, 0.00f), new Vector2(0.48f, 0.08f), ink, true);
            Shape(figure, "RightShoe", new Vector2(0.52f, 0.00f), new Vector2(0.74f, 0.08f), ink, true);

            coat = Shape(figure, "TravelCoat", new Vector2(0.18f, 0.28f), new Vector2(0.82f, 0.69f), brass, true);
            shirt = Shape(figure, "Shirt", new Vector2(0.39f, 0.36f), new Vector2(0.61f, 0.67f), ivory, true);
            Shape(figure, "LeftArm", new Vector2(0.10f, 0.31f), new Vector2(0.25f, 0.64f), brass, true);
            Shape(figure, "RightArm", new Vector2(0.75f, 0.31f), new Vector2(0.90f, 0.64f), brass, true);
            Shape(figure, "Neck", new Vector2(0.43f, 0.65f), new Vector2(0.57f, 0.75f), new Color(0.74f, 0.55f, 0.40f, 1f), true);
            Shape(figure, "Head", new Vector2(0.30f, 0.69f), new Vector2(0.70f, 0.99f), new Color(0.80f, 0.62f, 0.47f, 1f), true);
            hair = Shape(figure, "Hair", new Vector2(0.28f, 0.86f), new Vector2(0.72f, 1.00f), new Color(0.075f, 0.045f, 0.025f, 1f), true);
            scarf = Shape(figure, "StoryDetail", new Vector2(0.32f, 0.61f), new Vector2(0.68f, 0.72f), brass, true);

            monogram = Label(figure, "B", 28, font, ink, TextAnchor.MiddleCenter, new Vector2(0.39f, 0.43f), new Vector2(0.61f, 0.58f));
            nameLabel = Label(root.transform, "DEIN BIRDIE", 24, font, ivory, TextAnchor.MiddleCenter, new Vector2(0.05f, 0.01f), new Vector2(0.95f, 0.09f));
            storyLabel = Label(root.transform, "ENTDECKER:IN · FOREST", 13, font, brass, TextAnchor.MiddleCenter, new Vector2(0.05f, 0.90f), new Vector2(0.95f, 0.98f));
            if (portraitArt != null) figureRoot.SetActive(false);
        }

        public void Apply(CharacterProfile profile, string liveName)
        {
            if (profile == null || coat == null) return;

            var signature = SignatureColor(profile.color);
            coat.color = signature;
            scarf.color = Color.Lerp(signature, ivory, 0.32f);
            aura.color = new Color(signature.r, signature.g, signature.b, 0.18f);
            if (portraitArt != null) portraitArt.color = Color.Lerp(Color.white, signature, 0.07f);
            hair.color = HairColor(profile.story);
            shirt.color = string.Equals(profile.style, "midnight", System.StringComparison.OrdinalIgnoreCase)
                ? new Color(0.055f, 0.075f, 0.09f, 1f)
                : ivory;

            var displayName = string.IsNullOrWhiteSpace(liveName) ? "DEIN BIRDIE" : liveName.Trim().ToUpperInvariant();
            nameLabel.text = displayName;
            monogram.text = displayName == "DEIN BIRDIE" ? "B" : displayName.Substring(0, 1);
            storyLabel.text = $"{StoryName(profile.story)}  ·  {ColorName(profile.color)}";
        }

        private void Update()
        {
            if (figure == null) return;
            animationTime += Time.unscaledDeltaTime;
            figure.anchoredPosition = new Vector2(0f, Mathf.Sin(animationTime * 1.4f) * 3.5f);
            var pulse = 0.15f + (Mathf.Sin(animationTime * 1.1f) + 1f) * 0.025f;
            if (aura != null) aura.color = new Color(aura.color.r, aura.color.g, aura.color.b, pulse);
        }

        private static string StoryName(string value)
        {
            return value switch
            {
                "strategist" => "STRATEG:IN",
                "connoisseur" => "GENIESSER:IN",
                "builder" => "MACHER:IN",
                _ => "ENTDECKER:IN"
            };
        }

        private static string ColorName(string value)
        {
            return value switch
            {
                "midnight" => "MIDNIGHT",
                "sand" => "SAND",
                "burgundy" => "BURGUNDY",
                _ => "FOREST"
            };
        }

        private static Color SignatureColor(string value)
        {
            return value switch
            {
                "midnight" => new Color(0.075f, 0.14f, 0.24f, 1f),
                "sand" => new Color(0.55f, 0.42f, 0.28f, 1f),
                "burgundy" => new Color(0.35f, 0.07f, 0.08f, 1f),
                _ => new Color(0.035f, 0.22f, 0.14f, 1f)
            };
        }

        private static Color HairColor(string story)
        {
            return story switch
            {
                "strategist" => new Color(0.12f, 0.075f, 0.045f, 1f),
                "connoisseur" => new Color(0.19f, 0.12f, 0.065f, 1f),
                "builder" => new Color(0.055f, 0.04f, 0.025f, 1f),
                _ => new Color(0.075f, 0.045f, 0.025f, 1f)
            };
        }

        private static GameObject Panel(Transform parent, string name, Vector2 min, Vector2 max, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            go.GetComponent<Image>().color = color;
            return go;
        }

        private static Image Shape(Transform parent, string name, Vector2 min, Vector2 max, Color color, bool rounded = false)
        {
            var go = Panel(parent, name, min, max, color);
            var image = go.GetComponent<Image>();
            if (rounded)
            {
                image.sprite = RoundedSprite.Value;
                image.type = Image.Type.Sliced;
            }
            return image;
        }

        private static Text Label(Transform parent, string value, int size, Font font, Color color, TextAnchor anchor, Vector2 min, Vector2 max)
        {
            var go = new GameObject("Text", typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var label = go.GetComponent<Text>();
            label.font = font;
            label.text = value;
            label.fontSize = size;
            label.color = color;
            label.alignment = anchor;
            label.resizeTextForBestFit = true;
            label.resizeTextMinSize = 10;
            label.resizeTextMaxSize = size;
            label.supportRichText = false;
            return label;
        }

        private static void Stretch(RectTransform rect, Vector2 min, Vector2 max)
        {
            rect.anchorMin = min;
            rect.anchorMax = max;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
        }

        private static class RoundedSprite
        {
            public static readonly Sprite Value = Create();

            private static Sprite Create()
            {
                const int size = 32;
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
                {
                    name = "BirdieWorld Rounded UI",
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    hideFlags = HideFlags.HideAndDontSave
                };
                var pixels = new Color32[size * size];
                for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var distance = Vector2.Distance(new Vector2(x, y), new Vector2(15.5f, 15.5f));
                    pixels[y * size + x] = new Color32(255, 255, 255, distance <= 15.5f ? (byte)255 : (byte)0);
                }
                texture.SetPixels32(pixels);
                texture.Apply(false, true);
                return Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, new Vector4(12, 12, 12, 12));
            }
        }
    }
}
