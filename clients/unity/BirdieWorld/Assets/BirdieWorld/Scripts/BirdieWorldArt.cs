using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    /// <summary>
    /// Loads optional art-direction textures without making the Beta depend on an
    /// editor-authored scene. Missing resources fail back to the existing generated UI.
    /// </summary>
    public static class BirdieWorldArt
    {
        public static RawImage Cover(
            Transform parent,
            string name,
            string resourcePath,
            Vector2 min,
            Vector2 max,
            Color color)
        {
            var texture = Resources.Load<Texture2D>(resourcePath);
            if (texture == null) return null;

            var go = new GameObject(name, typeof(RectTransform), typeof(RawImage), typeof(BirdieWorldCoverImage));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var image = go.GetComponent<RawImage>();
            image.texture = texture;
            image.color = color;
            image.raycastTarget = false;
            go.GetComponent<BirdieWorldCoverImage>().Refresh();
            return image;
        }

        public static RawImage StretchImage(
            Transform parent,
            string name,
            string resourcePath,
            Vector2 min,
            Vector2 max,
            Color color)
        {
            var texture = Resources.Load<Texture2D>(resourcePath);
            if (texture == null) return null;

            var go = new GameObject(name, typeof(RectTransform), typeof(RawImage));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var image = go.GetComponent<RawImage>();
            image.texture = texture;
            image.color = color;
            image.raycastTarget = false;
            return image;
        }

        public static Image Tint(
            Transform parent,
            string name,
            Vector2 min,
            Vector2 max,
            Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            Stretch(go.GetComponent<RectTransform>(), min, max);
            var image = go.GetComponent<Image>();
            image.color = color;
            image.raycastTarget = false;
            return image;
        }

        private static void Stretch(RectTransform rect, Vector2 min, Vector2 max)
        {
            rect.anchorMin = min;
            rect.anchorMax = max;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
        }
    }

    /// <summary>Keeps a RawImage center-cropped like CSS background-size: cover.</summary>
    public sealed class BirdieWorldCoverImage : MonoBehaviour
    {
        private RawImage image;
        private float lastWidth = -1f;
        private float lastHeight = -1f;

        public void Refresh()
        {
            image = GetComponent<RawImage>();
            UpdateUv(true);
        }

        private void OnEnable()
        {
            UpdateUv(true);
        }

        private void OnRectTransformDimensionsChange()
        {
            UpdateUv(false);
        }

        private void UpdateUv(bool force)
        {
            image ??= GetComponent<RawImage>();
            if (image == null || image.texture == null) return;

            var rect = (RectTransform)transform;
            var width = rect.rect.width;
            var height = rect.rect.height;
            if (width <= 0f || height <= 0f) return;
            if (!force && Mathf.Approximately(width, lastWidth) && Mathf.Approximately(height, lastHeight)) return;

            lastWidth = width;
            lastHeight = height;
            var containerAspect = width / height;
            var textureAspect = (float)image.texture.width / image.texture.height;

            if (containerAspect > textureAspect)
            {
                var visibleHeight = textureAspect / containerAspect;
                image.uvRect = new Rect(0f, (1f - visibleHeight) * 0.5f, 1f, visibleHeight);
            }
            else
            {
                var visibleWidth = containerAspect / textureAspect;
                image.uvRect = new Rect((1f - visibleWidth) * 0.5f, 0f, visibleWidth, 1f);
            }
        }
    }
}
