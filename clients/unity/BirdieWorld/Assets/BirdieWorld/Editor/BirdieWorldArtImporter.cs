#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace BirdieWorld.Editor
{
    /// <summary>Applies deterministic, WebGL-safe import settings to the generated art layer.</summary>
    public sealed class BirdieWorldArtImporter : AssetPostprocessor
    {
        private const string ArtDirectory = "/Resources/BirdieWorldArt/";

        private void OnPreprocessTexture()
        {
            if (!assetPath.Contains(ArtDirectory)) return;

            var importer = (TextureImporter)assetImporter;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.filterMode = FilterMode.Bilinear;
            importer.isReadable = false;
            importer.maxTextureSize = 2048;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.wrapMode = TextureWrapMode.Clamp;
        }
    }
}
#endif
