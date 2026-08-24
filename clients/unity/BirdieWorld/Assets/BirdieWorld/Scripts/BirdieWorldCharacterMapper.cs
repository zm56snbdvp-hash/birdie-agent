using System;

namespace BirdieWorld
{
    public static class BirdieWorldCharacterMapper
    {
        public static CharacterWriteData ToServerWrite(CharacterProfile profile)
        {
            if (profile == null) throw new ArgumentNullException(nameof(profile));
            return new CharacterWriteData
            {
                displayName = profile.displayName?.Trim(),
                story = ToServerStory(profile.story),
                style = Upper(profile.style, "CLASSIC"),
                hair = Upper(profile.hair, "DEFAULT"),
                face = Upper(profile.face, "DEFAULT"),
                outfit = Upper(profile.outfit, "TRAVEL"),
                accessories = Upper(profile.accessories, "NONE"),
                color = Upper(profile.color, "FOREST")
            };
        }

        public static void ApplyServerProfile(CharacterProfile target, CharacterData source)
        {
            if (target == null || source == null) return;
            if (!string.IsNullOrWhiteSpace(source.characterId)) target.characterId = source.characterId;
            target.displayName = source.displayName?.Trim();
            target.story = ToLocalStory(source.story);
            target.style = Lower(source.style, "classic");
            target.hair = Lower(source.hair, "01");
            target.face = Lower(source.face, "01");
            target.outfit = Lower(source.outfit, "01");
            target.accessories = Lower(source.accessories, "none");
            target.color = Lower(source.color, "forest");
            if (!string.IsNullOrWhiteSpace(source.createdAt)) target.createdAt = source.createdAt;
            if (!string.IsNullOrWhiteSpace(source.updatedAt)) target.updatedAt = source.updatedAt;
            target.schemaVersion = string.IsNullOrWhiteSpace(source.schemaVersion)
                ? "birdieworld-character/v1"
                : source.schemaVersion;
        }

        private static string ToServerStory(string value)
        {
            switch (value?.Trim().ToLowerInvariant())
            {
                case "strategist":
                case "stratege":
                    return "STRATEGE";
                case "connoisseur":
                case "geniesser":
                    return "GENIESSER";
                default:
                    return "ENTDECKER";
            }
        }

        private static string ToLocalStory(string value)
        {
            switch (value?.Trim().ToUpperInvariant())
            {
                case "STRATEGE":
                case "STRATEGIST":
                    return "strategist";
                case "GENIESSER":
                case "CONNOISSEUR":
                    return "connoisseur";
                default:
                    return "explorer";
            }
        }

        private static string Upper(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToUpperInvariant();
        }

        private static string Lower(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToLowerInvariant();
        }
    }
}
