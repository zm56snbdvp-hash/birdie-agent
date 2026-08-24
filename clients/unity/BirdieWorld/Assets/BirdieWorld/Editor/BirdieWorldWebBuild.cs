#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace BirdieWorld.Editor
{
    public static class BirdieWorldWebBuild
    {
        private const string ScenePath = "Assets/BirdieWorld/Generated/Beta.unity";
        private const string OutputPath = "Builds/WebGL";

        [MenuItem("BirdieWorld/Build WebGL Beta")]
        public static void BuildWebGL()
        {
            EnsureScene();

            PlayerSettings.companyName = "Birdie & Breakfast";
            PlayerSettings.productName = "BirdieWorld Beta";
            PlayerSettings.SetApplicationIdentifier(
                NamedBuildTarget.WebGL,
                "de.birdieandbreakfast.birdieworld.beta"
            );
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = true;
            PlayerSettings.WebGL.template = "PROJECT:BirdieWorldBeta";

            Directory.CreateDirectory(OutputPath);
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = OutputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };

            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
                throw new BuildFailedException($"BirdieWorld WebGL build failed: {report.summary.result}");

            Debug.Log($"BirdieWorld WebGL beta ready at {Path.GetFullPath(OutputPath)}");
        }

        [MenuItem("BirdieWorld/Open Beta Scene")]
        public static void OpenBetaScene()
        {
            EnsureScene();
            EditorSceneManager.OpenScene(ScenePath);
        }

        private static void EnsureScene()
        {
            if (File.Exists(ScenePath)) return;
            var directory = Path.GetDirectoryName(ScenePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("BirdieWorld Beta Bootstrap").AddComponent<BirdieWorldBetaBootstrap>();
            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
        }
    }
}
#endif
