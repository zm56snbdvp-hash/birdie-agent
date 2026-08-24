using System;
using System.Text.RegularExpressions;
using UnityEngine;

namespace BirdieWorld
{
    [Serializable]
    public sealed class BirdieWorldSessionConfiguration
    {
        public string apiBaseUrl;
        public string bearerToken;
        public string sessionKey;
    }

    public sealed class BirdieWorldAuthSession : MonoBehaviour
    {
        [SerializeField] private BirdieWorldCharacterApi characterApi;

        public event Action Configured;
        public event Action Refreshed;
        public event Action<string> ConfigurationFailed;
        public event Action Cleared;

        public int Generation { get; private set; }
        private string currentSessionKey;

        public void Initialize(BirdieWorldCharacterApi api)
        {
            characterApi = api;
        }

        public void Apply(string apiBaseUrl, string bearerToken, string sessionKey)
        {
            var normalizedSessionKey = sessionKey?.Trim();
            if (characterApi == null ||
                string.IsNullOrEmpty(normalizedSessionKey) ||
                !Regex.IsMatch(normalizedSessionKey, "^[A-Za-z0-9._-]{16,128}$") ||
                !characterApi.Configure(apiBaseUrl, bearerToken))
            {
                RejectConfiguration("Birdie session configuration is invalid.");
                return;
            }

            var accountChanged = !string.Equals(currentSessionKey, normalizedSessionKey, StringComparison.Ordinal);
            currentSessionKey = normalizedSessionKey;
            if (!accountChanged)
            {
                Refreshed?.Invoke();
                return;
            }
            Generation++;
            Configured?.Invoke();
        }

        // Stable WebGL bridge entrypoint. The surrounding authenticated shell calls:
        // unityInstance.SendMessage("BirdieWorld Auth Session", "ApplyJson", json)
        public void ApplyJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                RejectConfiguration("Birdie session configuration is missing.");
                return;
            }

            BirdieWorldSessionConfiguration configuration;
            try
            {
                configuration = JsonUtility.FromJson<BirdieWorldSessionConfiguration>(json);
            }
            catch (Exception)
            {
                RejectConfiguration("Birdie session configuration is malformed.");
                return;
            }
            Apply(configuration?.apiBaseUrl, configuration?.bearerToken, configuration?.sessionKey);
        }

        private void RejectConfiguration(string message)
        {
            Generation++;
            currentSessionKey = null;
            characterApi?.ClearSession();
            ConfigurationFailed?.Invoke(message);
        }

        public void Clear()
        {
            Generation++;
            currentSessionKey = null;
            characterApi?.ClearSession();
            Cleared?.Invoke();
        }
    }
}
