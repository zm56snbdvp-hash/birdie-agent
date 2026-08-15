using System;
using UnityEngine;

namespace BirdieWorld.Foundation
{
    [Serializable]
    public sealed class BirdieWorldEstateManifest
    {
        public string contractVersion;
        public string sourcePresentationContract;
        public string worldId;
        public string status;
        public string units;
        public WorldBounds worldBounds;
        public PlayerSpec player;
        public CameraSpec camera;
        public LandmarkSpec[] landmarks;
        public CollisionShapes collisionShapes;
        public VisualSpec visual;
        public AmbientPersonSpec[] ambientPopulation;
        public string[] productDestinations;
        public Capabilities capabilities;
        public Governance governance;

        public const string ExpectedContract = "birdieworld-estate-handoff-v1";
        public const string ExpectedPresentation = "birdieworld-immersive-estate-v0.3.5";

        public static BirdieWorldEstateManifest ParseAndValidate(TextAsset source)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            var manifest = JsonUtility.FromJson<BirdieWorldEstateManifest>(source.text);
            if (manifest == null || manifest.contractVersion != ExpectedContract)
            {
                throw new InvalidOperationException("Unexpected BirdieWorld estate contract version.");
            }

            if (manifest.sourcePresentationContract != ExpectedPresentation)
            {
                throw new InvalidOperationException("Unexpected BirdieWorld presentation source.");
            }

            if (manifest.capabilities == null || manifest.capabilities.HasExpandedScope())
            {
                throw new InvalidOperationException("Unity foundation refuses manifests that enable gated capabilities.");
            }

            if (manifest.governance == null || manifest.governance.containsCanonicalBusinessState ||
                manifest.governance.containsPersonalData || manifest.governance.grantsWriteAuthority)
            {
                throw new InvalidOperationException("Unity foundation accepts presentation-only, non-authoritative data.");
            }

            return manifest;
        }

        public static Vector3 ToUnityPosition(Point3 source)
        {
            return new Vector3(source.x, source.y, -source.z);
        }

        public static float ToUnityYaw(float canonicalYawDegrees)
        {
            return -canonicalYawDegrees;
        }
    }

    [Serializable] public sealed class WorldBounds { public Point3 min; public Point3 max; public GroundSize groundSize; }
    [Serializable] public sealed class GroundSize { public float x; public float z; }
    [Serializable] public sealed class Point3 { public float x; public float y; public float z; public float yawDegrees; }
    [Serializable] public sealed class PlayerSpec { public Point3 spawn; public MovementBounds movementBounds; public float movementSpeedMetersPerSecond; public string stateAuthority; }
    [Serializable] public sealed class MovementBounds { public float minX; public float maxX; public float minZ; public float maxZ; }
    [Serializable] public sealed class CameraSpec { public string mode; public float nearClip; public float farClip; public CameraProfile desktop; public CompactCameraProfile compact; public float collisionSampleStep; }
    [Serializable] public class CameraProfile { public float fieldOfViewDegrees; public float distance; public float height; public float lookAhead; }
    [Serializable] public sealed class CompactCameraProfile : CameraProfile { public int maxViewportWidth; }
    [Serializable] public sealed class LandmarkSpec { public string id; public string districtId; public Point3 anchor; }
    [Serializable] public sealed class CollisionShapes { public CollisionRectangle[] rectangles; public CollisionCircle[] circles; }
    [Serializable] public sealed class CollisionRectangle { public string id; public float minX; public float maxX; public float minZ; public float maxZ; }
    [Serializable] public sealed class CollisionCircle { public string id; public float x; public float z; public float radius; }
    [Serializable] public sealed class VisualSpec { public string colorGradeVersion; public Palette palette; public Composition composition; public LightingSpec lighting; }
    [Serializable] public sealed class Composition { public string[] primaryAxis; public string silhouetteRule; public string[] referenceIntent; }
    [Serializable] public sealed class LightingSpec { public string toneMapping; public float exposure; public SunSpec sun; public CoolFillSpec coolFill; }
    [Serializable] public sealed class SunSpec { public string colorToken; public float intensity; public Point3 position; }
    [Serializable] public sealed class CoolFillSpec { public string color; public float intensity; public Point3 position; }
    [Serializable]
    public sealed class Palette
    {
        public string forestNight;
        public string forestDeep;
        public string forest;
        public string forestLight;
        public string grass;
        public string meadowDark;
        public string meadowLight;
        public string fairway;
        public string green;
        public string cream;
        public string path;
        public string pathEdge;
        public string gold;
        public string hotel;
        public string roof;
        public string stable;
        public string stableTrim;
        public string wood;
        public string water;
        public string waterEdge;
        public string sand;
        public string stone;
        public string rock;
        public string flowerWhite;
        public string flowerGold;
        public string flowerViolet;
        public string trunk;
        public string charcoal;
        public string windowGlass;
        public string warmLight;
        public string skyHaze;
        public string fog;
    }
    [Serializable] public sealed class AmbientPersonSpec { public string id; public string role; public Point3 anchor; public float yawDegrees; public string shirtMaterial; public string accentMaterial; }
    [Serializable]
    public sealed class Capabilities
    {
        public bool quests;
        public bool progression;
        public bool multiplayer;
        public bool persistentWorldState;
        public bool teleport;
        public bool locationTracking;

        public bool HasExpandedScope()
        {
            return quests || progression || multiplayer || persistentWorldState || teleport || locationTracking;
        }
    }
    [Serializable] public sealed class Governance { public bool containsCanonicalBusinessState; public bool containsPersonalData; public bool grantsWriteAuthority; public bool unknownAdditiveFieldsMayBeIgnored; }

    public sealed class BirdieWorldStableId : MonoBehaviour
    {
        [SerializeField] private string stableId;
        public string StableId => stableId;
        public void SetStableId(string value) => stableId = value;
    }
}
