using System;
using System.IO;
using BirdieWorld.Foundation;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace BirdieWorld.Editor
{
    public static class BirdieWorldFoundationBuilder
    {
        private const string ScenePath = "Assets/BirdieWorld/Scenes/BirdieEstate_Blockout.unity";
        private const string ManifestAssetPath = "Assets/Resources/BirdieWorld/birdieworld-estate-handoff-v1.json";

        [MenuItem("BirdieWorld/Prepare Unity Foundation")]
        public static void PrepareFoundation()
        {
            CopyAndValidateCanonicalManifest();
            EnsureFolder("Assets/BirdieWorld/Scenes");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "BirdieEstate_Blockout";
            var root = new GameObject("BirdieWorld_Foundation");
            var runtime = root.AddComponent<BirdieWorldFoundationRuntime>();
            var manifest = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestAssetPath);
            runtime.SetManifestAsset(manifest);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            PlayerSettings.companyName = "Birdie & Breakfast";
            PlayerSettings.productName = "BirdieWorld Supporter Beta";
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            PlayerSettings.WebGL.decompressionFallback = true;

            AssetDatabase.SaveAssets();
            Debug.Log("BirdieWorld Unity foundation prepared. Press Play to inspect the generated greybox.");
        }

        [MenuItem("BirdieWorld/Build Supporter Web")]
        public static void BuildSupporterWeb()
        {
            PrepareFoundation();
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "Web"));
            Directory.CreateDirectory(output);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            });

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException($"BirdieWorld Web build failed: {report.summary.result}");
            }

            Debug.Log($"BirdieWorld supporter Web build created at {output}. Verify account signup/login before sharing the URL.");
        }

        private static void CopyAndValidateCanonicalManifest()
        {
            var repositoryRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var source = Path.Combine(repositoryRoot, "client", "birdie-app-v1", "src", "contracts", "birdieworld-estate-handoff-v1.json");
            if (!File.Exists(source))
            {
                throw new FileNotFoundException("Canonical BirdieWorld handoff is missing.", source);
            }

            EnsureFolder("Assets/Resources/BirdieWorld");
            var destination = Path.GetFullPath(Path.Combine(Application.dataPath, "Resources", "BirdieWorld", "birdieworld-estate-handoff-v1.json"));
            File.Copy(source, destination, true);
            AssetDatabase.ImportAsset(ManifestAssetPath, ImportAssetOptions.ForceUpdate);
            BirdieWorldEstateManifest.ParseAndValidate(AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestAssetPath));
        }

        private static void EnsureFolder(string assetPath)
        {
            var segments = assetPath.Split('/');
            var current = segments[0];
            for (var index = 1; index < segments.Length; index++)
            {
                var next = $"{current}/{segments[index]}";
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, segments[index]);
                }
                current = next;
            }
        }
    }
}
