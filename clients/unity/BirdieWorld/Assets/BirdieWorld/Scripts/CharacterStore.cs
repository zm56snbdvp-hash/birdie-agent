using UnityEngine;

namespace BirdieWorld
{
    public sealed class CharacterStore
    {
        private const string PlayerPrefsKey = "birdieworld.character.v1";

        public CharacterProfile LoadOrCreate()
        {
            var raw = PlayerPrefs.GetString(PlayerPrefsKey, string.Empty);
            var existing = CharacterProfile.FromJson(raw);
            return existing ?? CharacterProfile.CreateDefault();
        }

        public void Save(CharacterProfile profile)
        {
            profile.Touch();
            PlayerPrefs.SetString(PlayerPrefsKey, profile.ToJson());
            PlayerPrefs.Save();
        }

        public void Clear()
        {
            PlayerPrefs.DeleteKey(PlayerPrefsKey);
            PlayerPrefs.Save();
        }
    }
}
