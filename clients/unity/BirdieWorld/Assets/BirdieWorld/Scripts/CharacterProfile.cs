using System;
using UnityEngine;

namespace BirdieWorld
{
    [Serializable]
    public sealed class CharacterProfile
    {
        public string schemaVersion = "birdieworld-character/v1";
        public string characterId;
        public string displayName;
        public string story = "explorer";
        public string style = "classic";
        public string hair = "01";
        public string face = "01";
        public string outfit = "01";
        public string accessories = "none";
        public string color = "forest";
        public string createdAt;
        public string updatedAt;

        public static CharacterProfile CreateDefault()
        {
            var now = DateTime.UtcNow.ToString("O");
            return new CharacterProfile
            {
                characterId = Guid.NewGuid().ToString("N"),
                createdAt = now,
                updatedAt = now
            };
        }

        public void Touch()
        {
            updatedAt = DateTime.UtcNow.ToString("O");
        }

        public string ToJson() => JsonUtility.ToJson(this);

        public static CharacterProfile FromJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            return JsonUtility.FromJson<CharacterProfile>(json);
        }
    }
}
