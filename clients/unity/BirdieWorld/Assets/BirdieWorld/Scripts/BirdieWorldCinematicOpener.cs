using System.Collections;
using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    public sealed class BirdieWorldCinematicOpener : MonoBehaviour
    {
        private GameObject overlayRoot;
        private CanvasGroup group;
        private RectTransform train;
        private Text chapter;
        private Text altitude;
        private bool leaving;
        private RectTransform brandLayout;
        private RectTransform chapterLayout;
        private RectTransform headlineLayout;
        private RectTransform introLayout;
        private RectTransform routeLayout;
        private RectTransform boardLayout;
        private RectTransform footerLayout;
        private int layoutWidth;
        private int layoutHeight;

        public void Build(Transform parent, System.Action onBoard)
        {
            overlayRoot = new GameObject("CinematicOpener", typeof(RectTransform), typeof(CanvasGroup), typeof(Image));
            var root = overlayRoot;
            root.transform.SetParent(parent, false);
            var rt = (RectTransform)root.transform;
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
            root.GetComponent<Image>().color = new Color(.008f,.018f,.014f,1);
            group = root.GetComponent<CanvasGroup>();

            brandLayout = MakeText(root.transform,"BIRDIE & BREAKFAST",42,new Vector2(.06f,.83f),new Vector2(.55f,.93f),new Color(.86f,.67f,.34f,1),TextAnchor.MiddleLeft).rectTransform;
            chapter = MakeText(root.transform,"THE BIRDIE EXPRESS",18,new Vector2(.06f,.78f),new Vector2(.45f,.84f),new Color(.72f,.67f,.55f,1),TextAnchor.MiddleLeft);
            chapterLayout = chapter.rectTransform;
            headlineLayout = MakeText(root.transform,"DEINE REISE BEGINNT HIER.",52,new Vector2(.06f,.57f),new Vector2(.58f,.75f),new Color(.94f,.91f,.83f,1),TextAnchor.MiddleLeft).rectTransform;
            introLayout = MakeText(root.transform,"Mit Leni durch tiefe Täler. Über steile Grate.\nHinauf zu einer Welt, die erst mit dir entsteht.",23,new Vector2(.06f,.43f),new Vector2(.56f,.57f),new Color(.78f,.76f,.69f,1),TextAnchor.UpperLeft).rectTransform;

            var route = new GameObject("Route",typeof(RectTransform),typeof(Image)); route.transform.SetParent(root.transform,false);
            var rr=(RectTransform)route.transform; rr.anchorMin=new Vector2(.62f,.14f);rr.anchorMax=new Vector2(.93f,.84f);rr.offsetMin=rr.offsetMax=Vector2.zero;
            routeLayout = rr;
            route.GetComponent<Image>().color=new Color(.025f,.07f,.052f,1); route.AddComponent<Outline>().effectColor=new Color(.58f,.43f,.22f,1);
            MakeText(route.transform,"THE DESCENT",16,new Vector2(.08f,.84f),new Vector2(.92f,.93f),new Color(.86f,.67f,.34f,1),TextAnchor.MiddleCenter);
            MakeText(route.transform,"╲\n  ╲\n    ╲_____\n          ╲___\n              ╲\n               ╱\n             ╱\n          ╱\n      ╱\n  ╱",36,new Vector2(.1f,.18f),new Vector2(.9f,.83f),new Color(.94f,.91f,.83f,1),TextAnchor.MiddleCenter);
            altitude=MakeText(route.transform,"VALLEY  •  -840 M",14,new Vector2(.08f,.06f),new Vector2(.92f,.14f),new Color(.72f,.67f,.55f,1),TextAnchor.MiddleCenter);

            var tg=new GameObject("Train",typeof(RectTransform),typeof(Image));tg.transform.SetParent(route.transform,false);train=(RectTransform)tg.transform;
            train.anchorMin=new Vector2(.15f,.68f);train.anchorMax=new Vector2(.38f,.75f);train.offsetMin=train.offsetMax=Vector2.zero;
            tg.GetComponent<Image>().color=new Color(.72f,.54f,.27f,1);

            var button=new GameObject("Board",typeof(RectTransform),typeof(Image),typeof(Button));button.transform.SetParent(root.transform,false);
            var br=(RectTransform)button.transform;br.anchorMin=new Vector2(.06f,.22f);br.anchorMax=new Vector2(.32f,.31f);br.offsetMin=br.offsetMax=Vector2.zero;
            boardLayout = br;
            button.GetComponent<Image>().color=new Color(.08f,.16f,.11f,1);button.AddComponent<Outline>().effectColor=new Color(.72f,.54f,.27f,1);
            MakeText(button.transform,"EINSTEIGEN",22,new Vector2(.05f,.1f),new Vector2(.95f,.9f),new Color(.94f,.91f,.83f,1),TextAnchor.MiddleCenter);
            button.GetComponent<Button>().onClick.AddListener(()=>{if(!leaving)StartCoroutine(Leave(onBoard));});
            footerLayout = MakeText(root.transform,"BETA 01  ·  CHARACTER CREATION",14,new Vector2(.06f,.10f),new Vector2(.42f,.16f),new Color(.62f,.51f,.32f,1),TextAnchor.MiddleLeft).rectTransform;
            ApplyResponsiveLayout(true);
            StartCoroutine(RoutePulse());
        }

        private IEnumerator RoutePulse(){float t=0;while(!leaving){ApplyResponsiveLayout();t+=Time.unscaledDeltaTime;float p=(Mathf.Sin(t*.8f)+1f)*.5f;train.anchorMin=new Vector2(Mathf.Lerp(.15f,.55f,p),Mathf.Lerp(.68f,.24f,p));train.anchorMax=train.anchorMin+new Vector2(.23f,.07f);altitude.text=p<.5f?"DESCENDING  •  VALLEY":"CLIMBING  •  THE NEST";yield return null;}}
        private IEnumerator Leave(System.Action done)
        {
            leaving = true;
            group.interactable = false;
            chapter.text = "LENI HAT EINEN PLATZ FÜR DICH FREIGEHALTEN.";
            for (float t = 0; t < 1; t += Time.unscaledDeltaTime / 1.15f)
            {
                group.alpha = 1 - t;
                yield return null;
            }
            group.blocksRaycasts = false;
            if (overlayRoot != null) overlayRoot.SetActive(false);
            done?.Invoke();
        }
        private void ApplyResponsiveLayout(bool force=false)
        {
            if(!force&&layoutWidth==Screen.width&&layoutHeight==Screen.height)return;
            layoutWidth=Screen.width;layoutHeight=Screen.height;
            if(layoutHeight>layoutWidth)
            {
                Stretch(brandLayout,new Vector2(.07f,.90f),new Vector2(.93f,.97f));
                Stretch(chapterLayout,new Vector2(.07f,.85f),new Vector2(.93f,.90f));
                Stretch(headlineLayout,new Vector2(.07f,.72f),new Vector2(.93f,.85f));
                Stretch(introLayout,new Vector2(.07f,.61f),new Vector2(.93f,.72f));
                Stretch(routeLayout,new Vector2(.10f,.27f),new Vector2(.90f,.59f));
                Stretch(boardLayout,new Vector2(.18f,.13f),new Vector2(.82f,.22f));
                Stretch(footerLayout,new Vector2(.15f,.05f),new Vector2(.85f,.10f));
            }
            else
            {
                Stretch(brandLayout,new Vector2(.06f,.83f),new Vector2(.55f,.93f));
                Stretch(chapterLayout,new Vector2(.06f,.78f),new Vector2(.45f,.84f));
                Stretch(headlineLayout,new Vector2(.06f,.57f),new Vector2(.58f,.75f));
                Stretch(introLayout,new Vector2(.06f,.43f),new Vector2(.56f,.57f));
                Stretch(routeLayout,new Vector2(.62f,.14f),new Vector2(.93f,.84f));
                Stretch(boardLayout,new Vector2(.06f,.22f),new Vector2(.32f,.31f));
                Stretch(footerLayout,new Vector2(.06f,.10f),new Vector2(.42f,.16f));
            }
        }
        private static void Stretch(RectTransform rect,Vector2 min,Vector2 max){if(rect==null)return;rect.anchorMin=min;rect.anchorMax=max;rect.offsetMin=rect.offsetMax=Vector2.zero;}
        private Text MakeText(Transform p,string s,int size,Vector2 min,Vector2 max,Color c,TextAnchor a){var g=new GameObject("Text",typeof(RectTransform),typeof(Text));g.transform.SetParent(p,false);var r=(RectTransform)g.transform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=r.offsetMax=Vector2.zero;var x=g.GetComponent<Text>();x.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");x.text=s;x.fontSize=size;x.color=c;x.alignment=a;x.resizeTextForBestFit=true;x.resizeTextMinSize=10;x.resizeTextMaxSize=size;return x;}
    }
}
