using UnityEngine;

namespace BirdieWorld
{
    public sealed class CharacterStore
    {
        private const string PlayerPrefsKey = "birdieworld.character.v1";

        public CharacterProfile LoadOrCreate()
        {
            var raw = PlayerPrefs.GetString(PlayerPrefsKey, string.Empty);
            try
            {
                var existing = CharacterProfile.FromJson(raw);
                return existing ?? CharacterProfile.CreateDefault();
            }
            catch (System.Exception)
            {
                Clear();
                return CharacterProfile.CreateDefault();
            }
        }

        public void Save(CharacterProfile profile)
        {
            profile.Touch();
            Persist(profile);
        }

        private static void Persist(CharacterProfile profile)
        {
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
