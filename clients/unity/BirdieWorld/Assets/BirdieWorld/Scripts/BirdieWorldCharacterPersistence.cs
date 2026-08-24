using System.Collections;
using UnityEngine;

namespace BirdieWorld
{
    public sealed class BirdieWorldCharacterPersistence : MonoBehaviour
    {
        [SerializeField] private BirdieWorldCharacterApi api;
        private Coroutine loadRequest;
        private Coroutine saveRequest;

        public bool IsServerConfigured => api != null && api.IsConfigured;

        public void Initialize(BirdieWorldCharacterApi characterApi)
        {
            api = characterApi;
        }

        public void LoadServerProfile(System.Action<CharacterData> onLoaded, System.Action<string> onError)
        {
            if (api == null)
            {
                onError?.Invoke("Birdie character API is unavailable.");
                return;
            }
            Cancel(ref loadRequest);
            loadRequest = StartCoroutine(LoadRoutine(onLoaded, onError));
        }

        public void SaveServerProfile(CharacterWriteData character, System.Action<CharacterData> onSaved, System.Action<string> onError)
        {
            if (api == null)
            {
                onError?.Invoke("Birdie character API is unavailable.");
                return;
            }
            Cancel(ref saveRequest);
            saveRequest = StartCoroutine(SaveRoutine(character, onSaved, onError));
        }

        public void CancelPendingRequests()
        {
            Cancel(ref loadRequest);
            Cancel(ref saveRequest);
        }

        private IEnumerator LoadRoutine(System.Action<CharacterData> onLoaded, System.Action<string> onError)
        {
            yield return api.Load(onLoaded, onError);
            loadRequest = null;
        }

        private IEnumerator SaveRoutine(CharacterWriteData character, System.Action<CharacterData> onSaved, System.Action<string> onError)
        {
            yield return api.Save(character, onSaved, onError);
            saveRequest = null;
        }

        private void Cancel(ref Coroutine request)
        {
            if (request == null) return;
            StopCoroutine(request);
            request = null;
        }
    }
}
