using System;
using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using UnityEngine;

namespace BirdieWorld.Foundation
{
    /// <summary>
    /// Minimal supporter account gate backed by Unity Authentication.
    /// It stores no password, secret, Coin state or profile data in the client.
    /// </summary>
    public sealed class BirdieWorldAccountGate : MonoBehaviour
    {
        private const int MinimumUsernameLength = 3;
        private const int MaximumUsernameLength = 20;
        private const int MinimumPasswordLength = 8;
        private const int MaximumPasswordLength = 30;

        private BirdieWorldFoundationWalker walker;
        private string username = string.Empty;
        private string password = string.Empty;
        private string status = "BirdieWorld verbindet sich ...";
        private bool initialized;
        private bool busy;
        private bool showPassword;
        private GUIStyle cardStyle;
        private GUIStyle titleStyle;
        private GUIStyle bodyStyle;
        private GUIStyle fieldStyle;
        private GUIStyle buttonStyle;
        private GUIStyle secondaryButtonStyle;
        private GUIStyle statusStyle;
        private Texture2D cardTexture;
        private Texture2D buttonTexture;
        private Texture2D secondaryTexture;

        public bool IsSignedIn => initialized && AuthenticationService.Instance.IsSignedIn;
        public string PlayerId => IsSignedIn ? AuthenticationService.Instance.PlayerId : string.Empty;

        public void Configure(BirdieWorldFoundationWalker controlledWalker)
        {
            walker = controlledWalker;
            SetWorldInput(false);
        }

        private async void Start()
        {
            await InitializeAuthenticationAsync();
        }

        private async Task InitializeAuthenticationAsync()
        {
            busy = true;
            try
            {
                await UnityServices.InitializeAsync();
                initialized = true;

                AuthenticationService.Instance.SignedIn += HandleSignedIn;
                AuthenticationService.Instance.SignedOut += HandleSignedOut;
                AuthenticationService.Instance.Expired += HandleExpired;

                if (AuthenticationService.Instance.SessionTokenExists)
                {
                    status = "Deine letzte Sitzung wird geöffnet ...";
                    await AuthenticationService.Instance.SignInAnonymouslyAsync();
                }
                else
                {
                    status = "Erstelle deinen BirdieWorld Account oder logge dich ein.";
                }
            }
            catch (Exception exception)
            {
                status = FriendlyError(exception, "Unity Services sind noch nicht verbunden.");
            }
            finally
            {
                busy = false;
                SetWorldInput(IsSignedIn);
            }
        }

        private async Task SignUpAsync()
        {
            if (!ValidateCredentials()) return;
            await RunAccountActionAsync(
                "Dein Account wird erstellt ...",
                () => AuthenticationService.Instance.SignUpWithUsernamePasswordAsync(username.Trim(), password));
        }

        private async Task SignInAsync()
        {
            if (!ValidateCredentials()) return;
            await RunAccountActionAsync(
                "Willkommen zurück ...",
                () => AuthenticationService.Instance.SignInWithUsernamePasswordAsync(username.Trim(), password));
        }

        private async Task RunAccountActionAsync(string progress, Func<Task> action)
        {
            if (!initialized || busy) return;
            busy = true;
            status = progress;
            try
            {
                await action();
                password = string.Empty;
            }
            catch (Exception exception)
            {
                status = FriendlyError(exception, "Das hat noch nicht funktioniert.");
            }
            finally
            {
                busy = false;
                SetWorldInput(IsSignedIn);
            }
        }

        private bool ValidateCredentials()
        {
            var cleanUsername = username.Trim();
            if (cleanUsername.Length < MinimumUsernameLength || cleanUsername.Length > MaximumUsernameLength)
            {
                status = "Benutzername: 3 bis 20 Zeichen.";
                return false;
            }

            if (password.Length < MinimumPasswordLength || password.Length > MaximumPasswordLength)
            {
                status = "Passwort: 8 bis 30 Zeichen.";
                return false;
            }

            return true;
        }

        private void HandleSignedIn()
        {
            status = "Willkommen in der BirdieWorld.";
            SetWorldInput(true);
        }

        private void HandleSignedOut()
        {
            status = "Du bist ausgeloggt.";
            SetWorldInput(false);
        }

        private void HandleExpired()
        {
            status = "Deine Sitzung ist abgelaufen. Bitte logge dich erneut ein.";
            SetWorldInput(false);
        }

        private void SignOut()
        {
            if (!initialized) return;
            AuthenticationService.Instance.SignOut();
            AuthenticationService.Instance.ClearSessionToken();
            username = string.Empty;
            password = string.Empty;
        }

        private void SetWorldInput(bool enabled)
        {
            if (walker != null) walker.enabled = enabled;
            Cursor.visible = !enabled;
            Cursor.lockState = CursorLockMode.None;
        }

        private void OnDestroy()
        {
            if (!initialized) return;
            AuthenticationService.Instance.SignedIn -= HandleSignedIn;
            AuthenticationService.Instance.SignedOut -= HandleSignedOut;
            AuthenticationService.Instance.Expired -= HandleExpired;
        }

        private void OnGUI()
        {
            BuildStyles();

            if (IsSignedIn)
            {
                DrawSignedInBadge();
                return;
            }

            var width = Mathf.Min(460f, Screen.width - 32f);
            var height = Mathf.Min(540f, Screen.height - 32f);
            var card = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f, width, height);

            GUI.Box(card, GUIContent.none, cardStyle);
            GUILayout.BeginArea(new Rect(card.x + 32f, card.y + 28f, card.width - 64f, card.height - 52f));
            GUILayout.Label("BIRDIE & BREAKFAST", bodyStyle);
            GUILayout.Space(8f);
            GUILayout.Label("Dein Eingang\nin die BirdieWorld", titleStyle);
            GUILayout.Space(12f);
            GUILayout.Label("Account erstellen oder einloggen – danach beginnt dein Rundgang.", bodyStyle);
            GUILayout.Space(22f);

            GUI.enabled = initialized && !busy;
            GUILayout.Label("BENUTZERNAME", bodyStyle);
            username = GUILayout.TextField(username, MaximumUsernameLength, fieldStyle, GUILayout.Height(48f));
            GUILayout.Space(12f);
            GUILayout.Label("PASSWORT", bodyStyle);
            password = showPassword
                ? GUILayout.TextField(password, MaximumPasswordLength, fieldStyle, GUILayout.Height(48f))
                : GUILayout.PasswordField(password, '•', MaximumPasswordLength, fieldStyle, GUILayout.Height(48f));
            showPassword = GUILayout.Toggle(showPassword, " Passwort anzeigen");
            GUILayout.Space(14f);

            if (GUILayout.Button(busy ? "BITTE WARTEN ..." : "ACCOUNT ERSTELLEN", buttonStyle, GUILayout.Height(50f)))
            {
                _ = SignUpAsync();
            }
            GUILayout.Space(8f);
            if (GUILayout.Button("EINLOGGEN", secondaryButtonStyle, GUILayout.Height(46f)))
            {
                _ = SignInAsync();
            }
            GUI.enabled = true;
            GUILayout.Space(14f);
            GUILayout.Label(status, statusStyle);
            GUILayout.FlexibleSpace();
            GUILayout.Label("Benutzername 3–20 Zeichen · Passwort 8–30 Zeichen mit Groß-/Kleinbuchstaben, Zahl und Symbol.", statusStyle);
            GUILayout.EndArea();
        }

        private void DrawSignedInBadge()
        {
            var rect = new Rect(16f, 16f, Mathf.Min(360f, Screen.width - 32f), 76f);
            GUI.Box(rect, GUIContent.none, cardStyle);
            GUILayout.BeginArea(new Rect(rect.x + 18f, rect.y + 12f, rect.width - 36f, rect.height - 20f));
            GUILayout.BeginHorizontal();
            GUILayout.BeginVertical();
            GUILayout.Label("BIRDIEWORLD · ONLINE", bodyStyle);
            GUILayout.Label($"Birdie {ShortPlayerId(PlayerId)}", statusStyle);
            GUILayout.EndVertical();
            if (GUILayout.Button("Logout", secondaryButtonStyle, GUILayout.Width(82f), GUILayout.Height(38f))) SignOut();
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        private void BuildStyles()
        {
            if (cardStyle != null) return;

            cardTexture = SolidTexture(new Color(0.035f, 0.075f, 0.06f, 0.96f));
            buttonTexture = SolidTexture(new Color(0.79f, 0.62f, 0.24f, 1f));
            secondaryTexture = SolidTexture(new Color(0.12f, 0.22f, 0.17f, 1f));

            cardStyle = new GUIStyle(GUI.skin.box) { normal = { background = cardTexture } };
            titleStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = Mathf.Clamp(Screen.width / 22, 28, 42),
                fontStyle = FontStyle.Bold,
                wordWrap = true,
                normal = { textColor = new Color(0.95f, 0.91f, 0.78f) }
            };
            bodyStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 13,
                wordWrap = true,
                normal = { textColor = new Color(0.76f, 0.82f, 0.76f) }
            };
            fieldStyle = new GUIStyle(GUI.skin.textField)
            {
                fontSize = 17,
                padding = new RectOffset(14, 14, 12, 10)
            };
            buttonStyle = new GUIStyle(GUI.skin.button)
            {
                fontSize = 14,
                fontStyle = FontStyle.Bold,
                normal = { background = buttonTexture, textColor = new Color(0.05f, 0.09f, 0.06f) },
                hover = { background = buttonTexture, textColor = new Color(0.05f, 0.09f, 0.06f) }
            };
            secondaryButtonStyle = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                normal = { background = secondaryTexture, textColor = Color.white },
                hover = { background = secondaryTexture, textColor = Color.white }
            };
            statusStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 12,
                wordWrap = true,
                normal = { textColor = new Color(0.78f, 0.72f, 0.58f) }
            };
        }

        private static Texture2D SolidTexture(Color color)
        {
            var texture = new Texture2D(1, 1);
            texture.SetPixel(0, 0, color);
            texture.Apply();
            return texture;
        }

        private static string ShortPlayerId(string playerId)
        {
            if (string.IsNullOrWhiteSpace(playerId)) return "online";
            return playerId.Length <= 10 ? playerId : playerId[..10];
        }

        private static string FriendlyError(Exception exception, string fallback)
        {
            var message = exception?.Message ?? fallback;
            if (message.Contains("project", StringComparison.OrdinalIgnoreCase) ||
                message.Contains("initialize", StringComparison.OrdinalIgnoreCase))
            {
                return "Unity Cloud ist noch nicht mit diesem Projekt verbunden.";
            }
            if (message.Contains("username", StringComparison.OrdinalIgnoreCase) &&
                message.Contains("already", StringComparison.OrdinalIgnoreCase))
            {
                return "Dieser Benutzername ist bereits vergeben.";
            }
            if (message.Contains("password", StringComparison.OrdinalIgnoreCase))
            {
                return "Passwort prüfen: Groß-/Kleinbuchstabe, Zahl und Symbol erforderlich.";
            }
            return message.Length > 150 ? fallback : message;
        }
    }
}
