using UnityEngine;

namespace BirdieWorld
{
    public sealed class BirdieWorldCharacterPersistence : MonoBehaviour
    {
        [SerializeField] private BirdieWorldCharacterApi api;

        public void LoadServerProfile(System.Action<CharacterData> onLoaded, System.Action<string> onError)
        {
            StartCoroutine(api.Load(onLoaded, onError));
        }

        public void SaveServerProfile(CharacterData character, System.Action<CharacterData> onSaved, System.Action<string> onError)
        {
            StartCoroutine(api.Save(character, onSaved, onError));
        }
    }
}
