using System;
using UnityEngine;
namespace BirdieWorld {
[Serializable] public sealed class BirdieWorldWalletProjection {
 public string schemaVersion; public WalletSubject subject; public string identityStatus; public string identityReason; public string birdieId; public bool balanceAvailable; public int balance; public string currency; public string authority; public string projectionMode; public string[] appliedTransactionIds; public int transactionCount; public bool readOnly;
 [Serializable] public sealed class WalletSubject { public string unityPlayerId; }
 public const string ExpectedSchemaVersion = "birdieworld-wallet-projection/v1";
 public static bool TryParse(string json,out BirdieWorldWalletProjection projection,out string error){ projection=null; error=null; if(string.IsNullOrWhiteSpace(json)){error="WALLET_EMPTY_RESPONSE";return false;} try{projection=JsonUtility.FromJson<BirdieWorldWalletProjection>(json);}catch(Exception){error="WALLET_INVALID_JSON";return false;} if(projection==null||projection.schemaVersion!=ExpectedSchemaVersion){projection=null;error="WALLET_SCHEMA_MISMATCH";return false;} if(!projection.readOnly||projection.authority!="COIN_TRANSACTIONS"){projection=null;error="WALLET_AUTHORITY_MISMATCH";return false;} return true; }
}
}
