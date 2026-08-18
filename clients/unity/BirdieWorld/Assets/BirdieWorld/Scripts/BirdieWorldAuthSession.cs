using UnityEngine;

namespace BirdieWorld
{
    public sealed class BirdieWorldAuthSession : MonoBehaviour
    {
        [SerializeField] private BirdieWorldCharacterApi characterApi;

        public void Apply(string apiBaseUrl, string bearerToken)
        {
            characterApi.Configure(apiBaseUrl, bearerToken);
        }
    }
}
