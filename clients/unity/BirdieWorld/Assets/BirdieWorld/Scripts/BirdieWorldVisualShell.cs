using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    public sealed class BirdieWorldVisualShell : MonoBehaviour
    {
        private readonly Color forest = new(0.025f, 0.075f, 0.055f, 1f);
        private readonly Color brass = new(0.72f, 0.54f, 0.28f, 1f);
        private readonly Color ivory = new(0.93f, 0.90f, 0.82f, 1f);

        public void Build(Transform root)
        {
            var canvas = root.gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            root.gameObject.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            root.gameObject.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            root.gameObject.AddComponent<GraphicRaycaster>();

            Panel(root, "Backdrop", Vector2.zero, Vector2.one, forest);
            var frame = Panel(root, "TrainWindow", new Vector2(.035f,.055f), new Vector2(.965f,.945f), new Color(.02f,.025f,.02f,.96f));
            Outline(frame, brass, 2);

            Text(root, "BIRDIE & BREAKFAST", 54, new Vector2(.07f,.82f), new Vector2(.54f,.93f), ivory, TextAnchor.MiddleLeft);
            Text(root, "BIRDIEWORLD", 20, new Vector2(.072f,.785f), new Vector2(.35f,.83f), brass, TextAnchor.MiddleLeft);
            Text(root, "DER BIRDIE EXPRESS WARTET.", 25, new Vector2(.07f,.68f), new Vector2(.49f,.75f), ivory, TextAnchor.MiddleLeft);
            Text(root, "Mit Leni durch Täler, über Grate und hinauf in eine Welt,\ndie mit deinem Birdie weiterwächst.", 20, new Vector2(.07f,.57f), new Vector2(.52f,.68f), new Color(.82f,.80f,.73f,1), TextAnchor.UpperLeft);

            var rail = Panel(root, "RailGlow", new Vector2(.55f,.13f), new Vector2(.93f,.78f), new Color(.08f,.11f,.085f,1));
            Outline(rail, brass, 1);
            Text(rail.transform, "BIRDIE EXPRESS", 32, new Vector2(.08f,.76f), new Vector2(.92f,.9f), brass, TextAnchor.MiddleCenter);
            Text(rail.transform, "↓  TIEF INS TAL\n\n   ╲══════╲\n           ╲══════╱\n\n↑  HOCH ZUM NEST", 27, new Vector2(.1f,.2f), new Vector2(.9f,.72f), ivory, TextAnchor.MiddleCenter);

            Button(root, "REISE BEGINNEN", new Vector2(.07f,.31f), new Vector2(.33f,.39f));
            Button(root, "MEIN BIRDIE", new Vector2(.07f,.205f), new Vector2(.33f,.285f));
            Text(root, "BETA 02  •  CHARACTER CREATION", 15, new Vector2(.07f,.10f), new Vector2(.45f,.15f), brass, TextAnchor.MiddleLeft);
        }

        private GameObject Panel(Transform parent,string name,Vector2 min,Vector2 max,Color color){var g=new GameObject(name,typeof(RectTransform),typeof(Image));g.transform.SetParent(parent,false);var r=(RectTransform)g.transform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=r.offsetMax=Vector2.zero;g.GetComponent<Image>().color=color;return g;}
        private void Outline(GameObject g,Color color,float distance){var o=g.AddComponent<Outline>();o.effectColor=color;o.effectDistance=new Vector2(distance,distance);}
        private void Text(Transform parent,string value,int size,Vector2 min,Vector2 max,Color color,TextAnchor align){var g=new GameObject("Text",typeof(RectTransform),typeof(Text));g.transform.SetParent(parent,false);var r=(RectTransform)g.transform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=r.offsetMax=Vector2.zero;var t=g.GetComponent<Text>();t.text=value;t.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");t.fontSize=size;t.color=color;t.alignment=align;t.resizeTextForBestFit=true;t.resizeTextMinSize=12;t.resizeTextMaxSize=size;}
        private void Button(Transform parent,string label,Vector2 min,Vector2 max){var g=Panel(parent,label,min,max,new Color(.12f,.10f,.055f,1));Outline(g,brass,2);Text(g.transform,label,22,new Vector2(.04f,.1f),new Vector2(.96f,.9f),ivory,TextAnchor.MiddleCenter);g.AddComponent<Button>().targetGraphic=g.GetComponent<Image>();}
    }
}
