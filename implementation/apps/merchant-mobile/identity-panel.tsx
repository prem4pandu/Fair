import { useEffect, useRef, useState } from "react";
import {
  Platform,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { NativeIdentityClient } from "./identity-client";
const application = "MERCHANT" as const;
export function IdentityPanel() {
  const client = useRef<NativeIdentityClient | null>(null);
  const [user, setUser] = useState<{
    displayName: string;
    emailVerificationStatus: string;
  } | null>(null);
  const [message, setMessage] = useState(
    "Password session has not been checked.",
  );
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const mounted = useRef(true);
  const epoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    if (Platform.OS === "web")
      return () => {
        mounted.current = false;
      };
    try {
      const identity = new NativeIdentityClient(
        process.env.EXPO_PUBLIC_FAIRBITE_API_URL,
        application,
        SecureStore,
        expoFetch,
      );
      client.current = identity;
      const bootstrapEpoch = epoch.current;
      setBusy(true);
      void identity
        .bootstrap()
        .then((restored) => {
          if (mounted.current && epoch.current === bootstrapEpoch) {
            setUser(restored);
            setMessage(
              restored
                ? "Session restored."
                : "Sign in to access your account.",
            );
          }
        })
        .catch(() => {
          if (mounted.current && epoch.current === bootstrapEpoch)
            setMessage("Session could not be restored. Sign in again.");
        })
        .finally(() => {
          if (mounted.current && epoch.current === bootstrapEpoch)
            setBusy(false);
        });
    } catch {
      setMessage("Identity backend is not configured correctly.");
    }
    return () => {
      mounted.current = false;
      epoch.current++;
      client.current?.invalidate();
      client.current = null;
    };
  }, []);
  if (Platform.OS === "web")
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>
          Native password sessions
        </Text>
        <Text>
          Authentication in this web export is disabled. Use the web application
          with its secure browser session transport. Native device verification
          remains pending.
        </Text>
      </View>
    );
  const run = async (
    action: "login" | "register" | "account" | "refresh" | "logout",
  ) => {
    const identity = client.current;
    if (!identity) {
      setMessage("Identity backend is not configured.");
      return;
    }
    if (signingOut) return;
    if (action === "logout") setSigningOut(true);
    const attempt = ++epoch.current;
    setBusy(true);
    setMessage("Working…");
    try {
      if (action === "login") await identity.login(email, password);
      if (action === "register") await identity.register(email, password, name);
      if (action === "account") await identity.account();
      if (action === "refresh") await identity.refresh();
      if (action === "logout") {
        setUser(null);
        await identity.logout();
      }
      if (mounted.current && epoch.current === attempt) {
        setUser(identity.user);
        setMessage(
          action === "logout"
            ? "Signed out. Local credentials cleared."
            : "Account session updated.",
        );
      }
    } catch (error) {
      if (mounted.current && epoch.current === attempt) {
        setUser(identity.user);
        setMessage(
          action === "logout"
            ? "Signed out in memory. Secure storage or server revocation could not be confirmed."
            : error instanceof Error
              ? error.message
              : "Identity request failed.",
        );
      }
    } finally {
      if (mounted.current && epoch.current === attempt) {
        setBusy(false);
        setSigningOut(false);
        setPassword("");
      }
    }
  };
  const button = (
    label: string,
    action: Parameters<typeof run>[0],
    always = false,
  ) => (
    <Pressable
      key={action}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy && (!always || signingOut) }}
      disabled={busy && (!always || signingOut)}
      onPress={() => {
        void run(action);
      }}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Password account
      </Text>
      {user ? (
        <>
          <Text>Signed in as {user.displayName}</Text>
          <Text>Email verification: {user.emailVerificationStatus}</Text>
          {button("Check account", "account")}
          {button("Refresh session", "refresh")}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Email"
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Password"
            placeholder="Password (12–128 characters)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          {(["CUSTOMER"] as readonly string[]).includes(application) && (
            <TextInput
              accessibilityLabel="Display name"
              placeholder="Display name for registration"
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
          )}
          {button("Sign in", "login")}
          {(["CUSTOMER"] as readonly string[]).includes(application) &&
            button("Create customer account", "register")}
        </>
      )}
      {button("Sign out and clear session", "logout", true)}
      <Text accessibilityLiveRegion="polite">{message}</Text>
      <Text>
        Password recovery, email/phone OTP and Google/Apple sign-in are
        unavailable in this packet.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { backgroundColor: "#fff", padding: 24, borderRadius: 20, gap: 14 },
  title: { fontSize: 22, fontWeight: "600", color: "#142b20" },
  input: {
    borderWidth: 1,
    borderColor: "#72867a",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#146c43",
    padding: 16,
    borderRadius: 10,
    minHeight: 48,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
