import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { StatusBar } from "expo-status-bar";
import { brand } from "@fairbite/brand";
import { checkConnection } from "./connection";

export default function App() {
  const [message, setMessage] = useState(
    "Backend connection has not been checked.",
  );
  const [busy, setBusy] = useState(false);
  const current = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      current.current?.abort();
      current.current = null;
    },
    [],
  );
  const connect = async () => {
    current.current?.abort();
    const attempt = new AbortController();
    current.current = attempt;
    setBusy(true);
    setMessage("Checking backend connection…");
    try {
      const info = await checkConnection(
        process.env.EXPO_PUBLIC_FAIRBITE_API_URL,
        attempt.signal,
        expoFetch,
      );
      if (current.current === attempt && !attempt.signal.aborted)
        setMessage(
          info.status === "ready"
            ? `${info.name} backend is ready.`
            : `${info.name} backend dependencies are unavailable. Please try again.`,
        );
    } catch (error) {
      if (current.current === attempt && !attempt.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : "Connection check failed.",
        );
    } finally {
      if (current.current === attempt && !attempt.signal.aborted) {
        setBusy(false);
        current.current = null;
      }
    }
  };
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.brand}>
          {brand.name}
        </Text>
        <Text accessibilityRole="header" style={styles.heading}>
          Customer workspace
        </Text>
        <Text style={styles.description}>
          Discover places to eat and manage your orders as customer workflows
          are implemented.
        </Text>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            Connection foundation
          </Text>
          <Text style={styles.body}>
            This application currently provides a public backend connection
            check. Product workflows are still in development.
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check backend connection"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={() => {
              void connect();
            }}
            style={({ pressed }) => [
              styles.button,
              (pressed || busy) && styles.dim,
            ]}
          >
            {busy && <ActivityIndicator color="#ffffff" />}
            <Text style={styles.buttonText}>
              {busy ? "Checking…" : "Check backend connection"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f4f8f5" },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 48,
    gap: 18,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  brand: { color: "#146c43", fontSize: 24, fontWeight: "700" },
  heading: { color: "#142b20", fontSize: 32, fontWeight: "700" },
  description: { color: "#40564a", fontSize: 17, lineHeight: 26 },
  card: { padding: 24, gap: 18, borderRadius: 20, backgroundColor: "#ffffff" },
  title: { fontSize: 22, color: "#142b20", fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 25, color: "#40564a" },
  status: { fontSize: 16, lineHeight: 25, color: "#142b20" },
  button: {
    padding: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#146c43",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  dim: { opacity: 0.65 },
});
