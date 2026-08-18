using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace BirdieWorld
{
    [Serializable]
    public sealed class CharacterEnvelope
    {
        public bool success;
        public CharacterData data;
    }

    [Serializable]
    public sealed class CharacterRequest
    {
        public CharacterData character;
    }

    [Serializable]
    public sealed class CharacterData
    {
        public string birdieId;
        public string displayName;
        public string story = "ENTDECKER";
        public string style = "CLASSIC";
        public string hair = "DEFAULT";
        public string face = "DEFAULT";
        public string outfit = "TRAVEL";
        public string accessories = "NONE";
        public string color = "FOREST";
        public string createdAt;
        public string updatedAt;
        public string schemaVersion;
    }

    public sealed class BirdieWorldCharacterApi : MonoBehaviour
    {
        [SerializeField] private string baseUrl = "https://agent.birdieandbreakfast.de";
        private string accessToken;

        public void Configure(string apiBaseUrl, string bearerToken)
        {
            if (!string.IsNullOrWhiteSpace(apiBaseUrl)) baseUrl = apiBaseUrl.TrimEnd('/');
            accessToken = bearerToken;
        }

        public IEnumerator Load(Action<CharacterData> onSuccess, Action<string> onError)
        {
            using var request = UnityWebRequest.Get($"{baseUrl}/birdie-app/v1/character");
            Authorize(request);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(request.error);
                yield break;
            }
            var envelope = JsonUtility.FromJson<CharacterEnvelope>(request.downloadHandler.text);
            onSuccess?.Invoke(envelope?.data);
        }

        public IEnumerator Save(CharacterData character, Action<CharacterData> onSuccess, Action<string> onError)
        {
            var payload = JsonUtility.ToJson(new CharacterRequest { character = character });
            using var request = new UnityWebRequest($"{baseUrl}/birdie-app/v1/character", "PUT");
            request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(payload));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            Authorize(request);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(request.downloadHandler?.text ?? request.error);
                yield break;
            }
            var envelope = JsonUtility.FromJson<CharacterEnvelope>(request.downloadHandler.text);
            onSuccess?.Invoke(envelope?.data);
        }

        private void Authorize(UnityWebRequest request)
        {
            if (!string.IsNullOrWhiteSpace(accessToken))
                request.SetRequestHeader("Authorization", $"Bearer {accessToken}");
        }
    }
}
