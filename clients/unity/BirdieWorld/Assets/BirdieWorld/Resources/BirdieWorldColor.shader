Shader "BirdieWorld/Color"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _EmissionColor ("Emission", Color) = (0, 0, 0, 0)
        _Metallic ("Metallic", Range(0, 1)) = 0
        _Glossiness ("Glossiness", Range(0, 1)) = 0.25
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        LOD 100

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 position : SV_POSITION;
                float3 worldNormal : TEXCOORD0;
            };

            fixed4 _Color;
            fixed4 _EmissionColor;

            v2f vert(appdata input)
            {
                v2f output;
                output.position = UnityObjectToClipPos(input.vertex);
                output.worldNormal = UnityObjectToWorldNormal(input.normal);
                return output;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                float3 normal = normalize(input.worldNormal);
                float3 lightDirection = normalize(float3(-0.35, 0.80, -0.25));
                float diffuse = saturate(dot(normal, lightDirection));
                // Keep the stylised dusk palette readable even on WebGL, where
                // dynamic scene lighting can be stripped or differ by device.
                float light = 0.58 + diffuse * 0.72;
                return fixed4(saturate(_Color.rgb * light + _EmissionColor.rgb), _Color.a);
            }
            ENDCG
        }
    }

    FallBack Off
}
