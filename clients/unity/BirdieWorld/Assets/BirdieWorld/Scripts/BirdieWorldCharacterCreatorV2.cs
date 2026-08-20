using System;
using UnityEngine;
using UnityEngine.UI;

namespace BirdieWorld
{
    public sealed class BirdieWorldCharacterCreatorV2 : MonoBehaviour
    {
        private readonly Color ink = new(.012f,.025f,.021f,1f);
        private readonly Color forest = new(.03f,.11f,.075f,1f);
        private readonly Color brass = new(.72f,.54f,.28f,1f);
        private readonly Color ivory = new(.93f,.90f,.82f,1f);
        private CharacterProfile profile;
        private CharacterStore store;
        private InputField nameField;
        private Text summary;
        private Text status;

        public void Build(Transform parent, CharacterProfile loaded, CharacterStore backingStore, Action onBack)
        {
            profile = loaded;
            store = backingStore;
            var root = Panel(parent,"CharacterCreatorV2",Vector2.zero,Vector2.one,ink);

            var cabin = Panel(root.transform,"Cabin",new Vector2(.03f,.05f),new Vector2(.49f,.95f),new Color(.02f,.055f,.04f,1));
            Outline(cabin,brass,2);
            Label(cabin.transform,"BIRDIE EXPRESS · PRIVATE CABIN",17,new Vector2(.07f,.88f),new Vector2(.93f,.95f),brass,TextAnchor.MiddleCenter);
            Label(cabin.transform,"DEIN BIRDIE",44,new Vector2(.08f,.72f),new Vector2(.92f,.86f),ivory,TextAnchor.MiddleCenter);
            Label(cabin.transform,"SILHOUETTE",20,new Vector2(.18f,.42f),new Vector2(.82f,.68f),new Color(.68f,.66f,.58f,1),TextAnchor.MiddleCenter);
            summary = Label(cabin.transform,"Noch keine Auswahl",18,new Vector2(.08f,.19f),new Vector2(.92f,.37f),new Color(.78f,.76f,.69f,1),TextAnchor.UpperCenter);
            Label(cabin.transform,"THE NEST AWAITS",14,new Vector2(.08f,.08f),new Vector2(.92f,.14f),brass,TextAnchor.MiddleCenter);

            var form = Panel(root.transform,"Form",new Vector2(.51f,.05f),new Vector2(.97f,.95f),new Color(.022f,.04f,.032f,.98f));
            Outline(form,new Color(.35f,.28f,.17f,1),1);
            Label(form.transform,"CHARACTER CREATION",30,new Vector2(.06f,.89f),new Vector2(.94f,.97f),ivory,TextAnchor.MiddleLeft);
            Label(form.transform,"01  IDENTITÄT    02  STYLE    03  BESTÄTIGEN",14,new Vector2(.06f,.84f),new Vector2(.94f,.89f),brass,TextAnchor.MiddleLeft);

            Label(form.transform,"NAME",14,new Vector2(.06f,.75f),new Vector2(.94f,.80f),brass,TextAnchor.MiddleLeft);
            nameField = Input(form.transform,new Vector2(.06f,.68f),new Vector2(.94f,.75f),"Wie heißt dein Birdie?");
            nameField.text = profile.displayName ?? string.Empty;
            nameField.onValueChanged.AddListener(_ => Refresh());

            Label(form.transform,"DEINE ROLLE",14,new Vector2(.06f,.60f),new Vector2(.94f,.65f),brass,TextAnchor.MiddleLeft);
            Choice(form.transform,"ENTDECKER:IN","explorer",new Vector2(.06f,.52f),new Vector2(.48f,.59f));
            Choice(form.transform,"STRATEG:IN","strategist",new Vector2(.52f,.52f),new Vector2(.94f,.59f));
            Choice(form.transform,"GENIESSER:IN","connoisseur",new Vector2(.06f,.44f),new Vector2(.48f,.51f));
            Choice(form.transform,"MACHER:IN","builder",new Vector2(.52f,.44f),new Vector2(.94f,.51f));

            Label(form.transform,"SIGNATURE LOOK",14,new Vector2(.06f,.35f),new Vector2(.94f,.40f),brass,TextAnchor.MiddleLeft);
            Choice(form.transform,"CLASSIC","classic",new Vector2(.06f,.27f),new Vector2(.30f,.34f),true);
            Choice(form.transform,"MIDNIGHT","midnight",new Vector2(.34f,.27f),new Vector2(.58f,.34f),true);
            Choice(form.transform,"TRAVEL","travel",new Vector2(.62f,.27f),new Vector2(.94f,.34f),true);

            Button(form.transform,"ZURÜCK",new Vector2(.06f,.08f),new Vector2(.32f,.16f),onBack);
            Button(form.transform,"BIRDIE SPEICHERN",new Vector2(.48f,.08f),new Vector2(.94f,.16f),Save);
            status = Label(form.transform,"",14,new Vector2(.06f,.01f),new Vector2(.94f,.06f),new Color(.76f,.74f,.67f,1),TextAnchor.MiddleCenter);
            Refresh();
        }

        private void Save()
        {
            var name = nameField.text.Trim();
            if(name.Length < 2){status.text="Bitte gib deinem Birdie einen Namen.";return;}
            profile.displayName=name;
            store.Save(profile);
            status.text="✓ Dein Birdie ist gespeichert. Willkommen an Bord.";
            Refresh();
        }

        private void Choice(Transform p,string title,string value,Vector2 min,Vector2 max,bool style=false)
        {
            Button(p,title,min,max,()=>{if(style) profile.style=value; else profile.story=value; Refresh();});
        }

        private void Refresh()
        {
            if(summary==null) return;
            var n=string.IsNullOrWhiteSpace(nameField?.text)?"UNBENANNT":nameField.text.Trim().ToUpperInvariant();
            summary.text=$"{n}\n{profile.story?.ToUpperInvariant()}\n{profile.style?.ToUpperInvariant()}";
        }

        private GameObject Panel(Transform p,string n,Vector2 min,Vector2 max,Color c){var g=new GameObject(n,typeof(RectTransform),typeof(Image));g.transform.SetParent(p,false);var r=(RectTransform)g.transform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=r.offsetMax=Vector2.zero;g.GetComponent<Image>().color=c;return g;}
        private void Outline(GameObject g,Color c,float d){var o=g.AddComponent<Outline>();o.effectColor=c;o.effectDistance=new Vector2(d,d);}
        private Text Label(Transform p,string s,int size,Vector2 min,Vector2 max,Color c,TextAnchor a){var g=new GameObject("Text",typeof(RectTransform),typeof(Text));g.transform.SetParent(p,false);var r=(RectTransform)g.transform;r.anchorMin=min;r.anchorMax=max;r.offsetMin=r.offsetMax=Vector2.zero;var t=g.GetComponent<Text>();t.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");t.text=s;t.fontSize=size;t.color=c;t.alignment=a;t.resizeTextForBestFit=true;t.resizeTextMinSize=10;t.resizeTextMaxSize=size;return t;}
        private InputField Input(Transform p,Vector2 min,Vector2 max,string placeholder){var g=Panel(p,"Input",min,max,new Color(.01f,.025f,.02f,1));Outline(g,new Color(.28f,.22f,.14f,1),1);var f=g.AddComponent<InputField>();var tx=Label(g.transform,"",20,new Vector2(.04f,.08f),new Vector2(.96f,.92f),ivory,TextAnchor.MiddleLeft);var ph=Label(g.transform,placeholder,18,new Vector2(.04f,.08f),new Vector2(.96f,.92f),new Color(.6f,.59f,.54f,1),TextAnchor.MiddleLeft);f.textComponent=tx;f.placeholder=ph;return f;}
        private GameObject Button(Transform p,string title,Vector2 min,Vector2 max,UnityEngine.Events.UnityAction action){var g=Panel(p,title,min,max,new Color(.055f,.095f,.07f,1));Outline(g,new Color(.42f,.32f,.19f,1),1);g.AddComponent<Button>().onClick.AddListener(action);Label(g.transform,title,16,new Vector2(.03f,.08f),new Vector2(.97f,.92f),ivory,TextAnchor.MiddleCenter);return g;}
    }
}
