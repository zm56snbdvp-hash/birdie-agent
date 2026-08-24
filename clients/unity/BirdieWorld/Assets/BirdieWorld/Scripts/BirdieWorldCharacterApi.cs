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
        public string error;
        public string message;
    }

    [Serializable]
    public sealed class CharacterRequest
    {
        public CharacterWriteData character;
    }

    [Serializable]
    public sealed class CharacterWriteData
    {
        public string displayName;
        public string story;
        public string style;
        public string hair;
        public string face;
        public string outfit;
        public string accessories;
        public string color;
    }

    [Serializable]
    public sealed class CharacterData
    {
        public string characterId;
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
        private const string ProductionHost = "agent.birdieandbreakfast.de";
        [SerializeField] private string baseUrl = "https://agent.birdieandbreakfast.de";
        private string accessToken;

        public bool IsConfigured => !string.IsNullOrWhiteSpace(accessToken);

        public bool Configure(string apiBaseUrl, string bearerToken)
        {
            if (string.IsNullOrWhiteSpace(bearerToken)) return false;

            var candidate = string.IsNullOrWhiteSpace(apiBaseUrl)
                ? baseUrl
                : apiBaseUrl.Trim().TrimEnd('/');
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri)) return false;
            if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
            if (!string.IsNullOrEmpty(uri.UserInfo) || (uri.AbsolutePath != "/" && !string.IsNullOrEmpty(uri.AbsolutePath))) return false;
            var production = uri.Scheme == Uri.UriSchemeHttps &&
                uri.IsDefaultPort &&
                string.Equals(uri.Host, ProductionHost, StringComparison.OrdinalIgnoreCase);
            var localDevelopment = uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback &&
                (Application.isEditor || Debug.isDebugBuild);
            if (!production && !localDevelopment) return false;

            baseUrl = candidate;
            accessToken = bearerToken.Trim();
            return true;
        }

        public void ClearSession()
        {
            accessToken = null;
        }

        public IEnumerator Load(Action<CharacterData> onSuccess, Action<string> onError)
        {
            if (!IsConfigured)
            {
                onError?.Invoke("Birdie session is not configured.");
                yield break;
            }

            using var request = UnityWebRequest.Get($"{baseUrl}/birdie-app/v1/character");
            request.timeout = 20;
            Authorize(request);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(ResponseError(request));
                yield break;
            }
            CharacterEnvelope envelope;
            try
            {
                envelope = JsonUtility.FromJson<CharacterEnvelope>(request.downloadHandler.text);
            }
            catch (Exception)
            {
                onError?.Invoke("Invalid Birdie character response.");
                yield break;
            }
            if (envelope == null || !envelope.success)
            {
                onError?.Invoke(envelope?.error ?? envelope?.message ?? "Invalid Birdie character response.");
                yield break;
            }
            onSuccess?.Invoke(envelope?.data);
        }

        public IEnumerator Save(CharacterWriteData character, Action<CharacterData> onSuccess, Action<string> onError)
        {
            if (!IsConfigured)
            {
                onError?.Invoke("Birdie session is not configured.");
                yield break;
            }

            var payload = JsonUtility.ToJson(new CharacterRequest { character = character });
            using var request = new UnityWebRequest($"{baseUrl}/birdie-app/v1/character", "POST");
            request.timeout = 20;
            request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(payload));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            Authorize(request);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError?.Invoke(ResponseError(request));
                yield break;
            }
            CharacterEnvelope envelope;
            try
            {
                envelope = JsonUtility.FromJson<CharacterEnvelope>(request.downloadHandler.text);
            }
            catch (Exception)
            {
                onError?.Invoke("Invalid Birdie character response.");
                yield break;
            }
            if (envelope == null || !envelope.success || envelope.data == null)
            {
                onError?.Invoke(envelope?.error ?? envelope?.message ?? "Invalid Birdie character response.");
                yield break;
            }
            onSuccess?.Invoke(envelope?.data);
        }

        private void Authorize(UnityWebRequest request)
        {
            if (!string.IsNullOrWhiteSpace(accessToken))
                request.SetRequestHeader("Authorization", $"Bearer {accessToken}");
        }

        private static string ResponseError(UnityWebRequest request)
        {
            var body = request.downloadHandler?.text;
            return string.IsNullOrWhiteSpace(body) ? request.error : body;
        }
    }
}
