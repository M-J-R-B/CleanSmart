# CleanSmart Plan 8 — Mobile App Polish & Store Readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the React Native client and worker apps from feature-complete to store-submittable: onboarding flows, error/empty states, deep linking, push-tap navigation, EAS Build config, and iOS/Android store assets.

**Architecture:** Two Expo (managed) apps under `apps/client` and `apps/worker`, sharing types from `packages/shared`. Expo Router for navigation, Expo Notifications for push, EAS Build for binaries, EAS Submit for store uploads.

**Tech Stack:** React Native 0.74, Expo SDK 51, Expo Router 3, expo-notifications, expo-linking, EAS CLI, TypeScript 5.

---

## Prerequisites

- Plans 1–7 complete (API live, auth/jobs/quotes/bookings/reviews/disputes all functional).
- Both apps already wired to API base URL via `EXPO_PUBLIC_API_URL`.
- Apple Developer + Google Play Console accounts owned by user (out-of-band).

---

## File Structure

Per app (`apps/client` and `apps/worker`):

- `app/_layout.tsx` — root layout, deep link handler, push notification responder
- `app/(onboarding)/welcome.tsx`, `phone.tsx`, `otp.tsx`, `profile.tsx` — onboarding stack
- `app/(tabs)/...` — main app tabs (already exists; we polish)
- `components/EmptyState.tsx` — shared empty-state component
- `components/ErrorBoundary.tsx` — top-level RN error boundary
- `components/LoadingScreen.tsx`
- `lib/deepLinks.ts` — URL → route mapping
- `lib/pushHandler.ts` — handle notification taps
- `assets/icon.png`, `assets/splash.png`, `assets/adaptive-icon.png` — store-grade assets
- `app.config.ts` — Expo config with scheme, bundle IDs, EAS project
- `eas.json` — EAS Build profiles

Worker-specific extras: `app/(onboarding)/trades.tsx`, `app/(onboarding)/stripe.tsx`, `app/(onboarding)/persona.tsx`.

---

## Task 1: Shared UI primitives

**Files:**
- Create: `apps/client/components/EmptyState.tsx`
- Create: `apps/client/components/LoadingScreen.tsx`
- Create: `apps/client/components/ErrorBoundary.tsx`
- Create: `apps/worker/components/EmptyState.tsx`
- Create: `apps/worker/components/LoadingScreen.tsx`
- Create: `apps/worker/components/ErrorBoundary.tsx`

- [ ] **Step 1: Write `EmptyState.tsx`** (identical in both apps)

```tsx
import { View, Text, Pressable } from "react-native";

type Props = {
  icon?: string;
  title: string;
  body?: string;
  cta?: { label: string; onPress: () => void };
};

export function EmptyState({ icon = "📭", title, body, cta }: Props) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>{title}</Text>
      {body && <Text style={{ textAlign: "center", color: "#666", marginBottom: 24 }}>{body}</Text>}
      {cta && (
        <Pressable
          onPress={cta.onPress}
          style={{ backgroundColor: "#0066ff", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>{cta.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Write `LoadingScreen.tsx`**

```tsx
import { View, ActivityIndicator } from "react-native";

export function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
```

- [ ] **Step 3: Write `ErrorBoundary.tsx`**

```tsx
import React from "react";
import { View, Text, Pressable } from "react-native";

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("[ErrorBoundary]", error); }
  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>⚠️</Text>
          <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ textAlign: "center", color: "#666", marginBottom: 24 }}>{this.state.error.message}</Text>
          <Pressable onPress={this.reset} style={{ backgroundColor: "#0066ff", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Wrap root layout in ErrorBoundary** (both apps, edit `app/_layout.tsx`)

```tsx
import { Stack } from "expo-router";
import { ErrorBoundary } from "../components/ErrorBoundary";

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ErrorBoundary>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/components apps/worker/components apps/client/app/_layout.tsx apps/worker/app/_layout.tsx
git commit -m "feat(mobile): shared empty/loading/error primitives"
```

---

## Task 2: Client onboarding flow

**Files:**
- Create: `apps/client/app/(onboarding)/_layout.tsx`
- Create: `apps/client/app/(onboarding)/welcome.tsx`
- Create: `apps/client/app/(onboarding)/phone.tsx`
- Create: `apps/client/app/(onboarding)/otp.tsx`
- Create: `apps/client/app/(onboarding)/profile.tsx`
- Modify: `apps/client/app/index.tsx` (route gate)

- [ ] **Step 1: Onboarding layout (stack, no header)**

```tsx
import { Stack } from "expo-router";
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
```

- [ ] **Step 2: Welcome screen**

```tsx
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";

export default function Welcome() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 32, fontWeight: "700", marginBottom: 8 }}>CleanSmart</Text>
      <Text style={{ fontSize: 18, color: "#666", marginBottom: 48 }}>
        Get a quote from local pros in minutes.
      </Text>
      <Pressable
        onPress={() => router.push("/(onboarding)/phone")}
        style={{ backgroundColor: "#0066ff", padding: 16, borderRadius: 8, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Get started</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 3: Phone screen** — calls `POST /auth/otp`; on success navigates to OTP screen with `phone` param.

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../../lib/api";

export default function Phone() {
  const router = useRouter();
  const [phone, setPhone] = useState("+1");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      await api.post("/auth/otp", { phone });
      router.push({ pathname: "/(onboarding)/otp", params: { phone } });
    } catch (e: any) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  };
  return (
    <View style={{ flex: 1, padding: 32, paddingTop: 80 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 24 }}>Your phone number</Text>
      <TextInput
        value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus
        style={{ borderBottomWidth: 1, fontSize: 18, paddingVertical: 8, marginBottom: 32 }}
      />
      <Pressable onPress={submit} disabled={loading} style={{ backgroundColor: "#0066ff", padding: 16, borderRadius: 8, alignItems: "center", opacity: loading ? 0.5 : 1 }}>
        <Text style={{ color: "#fff", fontWeight: "600" }}>{loading ? "Sending…" : "Send code"}</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: OTP screen** — calls `POST /auth/verify`, stores tokens, routes to profile if new user else home.

- [ ] **Step 5: Profile screen** — collects display name + home address (uses Expo Location for forward geocoding); PATCHes `/me`. On success navigate to `/(tabs)`.

- [ ] **Step 6: Route gate** — `app/index.tsx` checks for stored token; if absent → `/(onboarding)/welcome`, if present → `/(tabs)`.

```tsx
import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { LoadingScreen } from "../components/LoadingScreen";

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync("accessToken");
      router.replace(token ? "/(tabs)" : "/(onboarding)/welcome");
    })();
  }, []);
  return <LoadingScreen />;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/client/app
git commit -m "feat(client): onboarding flow"
```

---

## Task 3: Worker onboarding flow

**Files:**
- Create: `apps/worker/app/(onboarding)/_layout.tsx`
- Create: `apps/worker/app/(onboarding)/welcome.tsx`
- Create: `apps/worker/app/(onboarding)/phone.tsx`
- Create: `apps/worker/app/(onboarding)/otp.tsx`
- Create: `apps/worker/app/(onboarding)/profile.tsx`
- Create: `apps/worker/app/(onboarding)/trades.tsx`
- Create: `apps/worker/app/(onboarding)/stripe.tsx`
- Create: `apps/worker/app/(onboarding)/persona.tsx`
- Create: `apps/worker/app/(onboarding)/done.tsx`
- Modify: `apps/worker/app/index.tsx`

- [ ] **Step 1: Layout** — same shape as client.

- [ ] **Step 2-4: Welcome / phone / otp** — copy from client app, change role to `worker` on verify.

- [ ] **Step 5: Profile** — display name, home address (geocoded), service radius slider (5–50 km, default 25). PATCH `/me`.

- [ ] **Step 6: Trades** — `GET /trades`, multi-select chips, `PUT /me/worker/trades` with selected trade IDs.

- [ ] **Step 7: Stripe Connect**

```tsx
import { View, Text, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../../lib/api";

export default function Stripe() {
  const router = useRouter();
  const onConnect = async () => {
    const { url } = await api.post("/me/worker/stripe/onboarding");
    await Linking.openURL(url);
    router.push("/(onboarding)/persona");
  };
  return (
    <View style={{ flex: 1, padding: 32, paddingTop: 80 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 8 }}>Set up payments</Text>
      <Text style={{ color: "#666", marginBottom: 32 }}>
        We use Stripe so you get paid directly. This takes about 5 minutes.
      </Text>
      <Pressable onPress={onConnect} style={{ backgroundColor: "#0066ff", padding: 16, borderRadius: 8, alignItems: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "600" }}>Connect with Stripe</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 8: Persona** — opens hosted Persona inquiry URL (started server-side by `POST /me/worker/persona/start` returning `inquiryUrl`); on return navigate to `done`.

- [ ] **Step 9: Done** — celebratory screen, "Browse jobs" CTA → `/(tabs)/feed`.

- [ ] **Step 10: Commit**

```bash
git add apps/worker/app
git commit -m "feat(worker): onboarding flow with stripe + persona"
```

---

## Task 4: Empty states across all main screens

**Files:**
- Modify: `apps/client/app/(tabs)/jobs.tsx`, `quotes/[jobId].tsx`, `bookings.tsx`, `messages.tsx`
- Modify: `apps/worker/app/(tabs)/feed.tsx`, `quotes.tsx`, `bookings.tsx`, `messages.tsx`

- [ ] **Step 1: Replace bare empty list rendering with `<EmptyState />`** in each screen.

Example (`apps/client/app/(tabs)/jobs.tsx`):

```tsx
if (data.length === 0) {
  return (
    <EmptyState
      icon="🧰"
      title="No jobs yet"
      body="Post a job and local pros will send quotes."
      cta={{ label: "Post a job", onPress: () => router.push("/jobs/new") }}
    />
  );
}
```

- [ ] **Step 2: Worker feed empty** — `"No jobs in your area"`, body `"We'll notify you when new jobs match your trades."`, no CTA.

- [ ] **Step 3: Bookings empty** (both apps) — distinct messages for client vs worker.

- [ ] **Step 4: Messages empty** — `"No conversations yet"`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/app/\(tabs\) apps/worker/app/\(tabs\)
git commit -m "feat(mobile): empty states on main screens"
```

---

## Task 5: Deep linking

**Files:**
- Create: `apps/client/lib/deepLinks.ts`
- Create: `apps/worker/lib/deepLinks.ts`
- Modify: `apps/client/app.config.ts`, `apps/worker/app.config.ts`
- Modify: `apps/client/app/_layout.tsx`, `apps/worker/app/_layout.tsx`

- [ ] **Step 1: Add scheme to `app.config.ts`** (both apps)

```ts
export default {
  expo: {
    name: "CleanSmart",
    slug: "cleansmart-client", // -worker for worker app
    scheme: "cleansmart",      // cleansmart-worker for worker
    ios: { bundleIdentifier: "com.cleansmart.client", supportsTablet: false },
    android: { package: "com.cleansmart.client", adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0066ff" } },
    icon: "./assets/icon.png",
    splash: { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#ffffff" },
    plugins: ["expo-router", "expo-notifications", "expo-secure-store"],
    extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
  },
};
```

- [ ] **Step 2: Write `lib/deepLinks.ts`** — maps notification data payloads to routes.

```ts
import { Router } from "expo-router";

export type DeepLinkData =
  | { type: "quote_received"; jobId: string }
  | { type: "quote_accepted"; bookingId: string }
  | { type: "message"; jobId: string }
  | { type: "review_prompt"; bookingId: string }
  | { type: "dispute_resolved"; bookingId: string };

export function navigateForData(router: Router, data: DeepLinkData) {
  switch (data.type) {
    case "quote_received": router.push(`/jobs/${data.jobId}/quotes`); return;
    case "quote_accepted": router.push(`/bookings/${data.bookingId}`); return;
    case "message": router.push(`/messages/${data.jobId}`); return;
    case "review_prompt": router.push(`/bookings/${data.bookingId}/review`); return;
    case "dispute_resolved": router.push(`/bookings/${data.bookingId}`); return;
  }
}
```

- [ ] **Step 3: Wire push response listener in `app/_layout.tsx`**

```tsx
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { navigateForData } from "../lib/deepLinks";

// inside component:
const router = useRouter();
useEffect(() => {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const data = resp.notification.request.content.data as any;
    if (data?.type) navigateForData(router, data);
  });
  return () => sub.remove();
}, [router]);
```

- [ ] **Step 4: Test universal links** — run app, send self-test push via `expo push:send` or trigger from API; tap notification, confirm route opens.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib apps/client/app.config.ts apps/client/app/_layout.tsx apps/worker/lib apps/worker/app.config.ts apps/worker/app/_layout.tsx
git commit -m "feat(mobile): deep linking from push notifications"
```

---

## Task 6: Push token registration on login

**Files:**
- Create: `apps/client/lib/registerPush.ts`
- Create: `apps/worker/lib/registerPush.ts`
- Modify: `apps/client/app/(onboarding)/profile.tsx` (call after profile save)
- Modify: `apps/worker/app/(onboarding)/done.tsx` (call before navigating in)

- [ ] **Step 1: Write `registerPush.ts`**

```ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

export async function registerForPushAsync(): Promise<void> {
  if (!Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== "granted") {
    const { status: req } = await Notifications.requestPermissionsAsync();
    status = req;
  }
  if (status !== "granted") return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.post("/me/push-tokens", { token, platform: Platform.OS });
}
```

- [ ] **Step 2: Call after onboarding completes** in both apps.

- [ ] **Step 3: Set Android notification channel** in `app/_layout.tsx`

```tsx
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

useEffect(() => {
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "default", importance: Notifications.AndroidImportance.HIGH,
    });
  }
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/lib/registerPush.ts apps/client/app apps/worker/lib/registerPush.ts apps/worker/app
git commit -m "feat(mobile): register push token after onboarding"
```

---

## Task 7: Network + auth error handling

**Files:**
- Modify: `apps/client/lib/api.ts`, `apps/worker/lib/api.ts`

- [ ] **Step 1: Wrap fetch with refresh-on-401 + offline detection**

```ts
import * as SecureStore from "expo-secure-store";

const BASE = process.env.EXPO_PUBLIC_API_URL!;

async function refresh(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync("refreshToken");
  if (!refreshToken) return null;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  const { accessToken, refreshToken: next } = await res.json();
  await SecureStore.setItemAsync("accessToken", accessToken);
  await SecureStore.setItemAsync("refreshToken", next);
  return accessToken;
}

async function request(method: string, path: string, body?: unknown, retried = false): Promise<any> {
  const token = await SecureStore.getItemAsync("accessToken");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Network unavailable. Check your connection.");
  }
  if (res.status === 401 && !retried) {
    const next = await refresh();
    if (next) return request(method, path, body, true);
    await SecureStore.deleteItemAsync("accessToken");
    await SecureStore.deleteItemAsync("refreshToken");
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p: string) => request("GET", p),
  post: (p: string, b?: unknown) => request("POST", p, b),
  patch: (p: string, b?: unknown) => request("PATCH", p, b),
  put: (p: string, b?: unknown) => request("PUT", p, b),
  delete: (p: string) => request("DELETE", p),
};
```

- [ ] **Step 2: Verify** — kill API server, try a request, confirm friendly error shows.

- [ ] **Step 3: Commit**

```bash
git add apps/client/lib/api.ts apps/worker/lib/api.ts
git commit -m "feat(mobile): refresh-on-401 and friendly network errors"
```

---

## Task 8: Store assets

**Files:**
- Create: `apps/client/assets/icon.png` (1024x1024)
- Create: `apps/client/assets/adaptive-icon.png` (1024x1024 foreground, transparent bg)
- Create: `apps/client/assets/splash.png` (1284x2778)
- Same three for `apps/worker/assets/`
- Create: `docs/store/client-screenshots/` — 6.5" iPhone + 6.7" Pixel screenshots
- Create: `docs/store/worker-screenshots/` — same
- Create: `docs/store/listing-copy.md` — title, subtitle, description, keywords for both apps

- [ ] **Step 1: Generate icons** (out-of-band; designer or AI tool). Place files at the paths above.

- [ ] **Step 2: Run app on iOS simulator (iPhone 15 Pro Max)** and capture screenshots: home/feed, quotes, booking detail, messages, review.

- [ ] **Step 3: Run app on Android emulator (Pixel 7 Pro)** and capture same screens.

- [ ] **Step 4: Write `docs/store/listing-copy.md`** with both apps' marketing copy:

```markdown
## CleanSmart (client)
**Title:** CleanSmart — Get Quotes from Pros
**Subtitle:** Plumbers, electricians, cleaners — fast.
**Description:** Post a job in 60 seconds. Get quotes from local pros. Pay safely with built-in escrow — released only when the work is done.

## CleanSmart Pro (worker)
**Title:** CleanSmart Pro — Find Local Gigs
**Subtitle:** Quote, book, get paid.
**Description:** See nearby jobs that match your trades. Send quotes, message clients, get paid via Stripe. No subscriptions — just a flat 15% only when you earn.
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/assets apps/worker/assets docs/store
git commit -m "chore(store): icons, splash, screenshots, listing copy"
```

---

## Task 9: EAS Build configuration

**Files:**
- Create: `apps/client/eas.json`
- Create: `apps/worker/eas.json`

- [ ] **Step 1: Install EAS CLI** (out-of-band)

```bash
pnpm add -g eas-cli
eas login
```

- [ ] **Step 2: Initialize EAS project** for each app

```bash
cd apps/client && eas init
cd ../worker && eas init
```

- [ ] **Step 3: Write `eas.json`** (both apps, identical)

```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "http://localhost:3000" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "https://api-staging.cleansmart.app" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://api.cleansmart.app" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "$APPLE_ID", "ascAppId": "$ASC_APP_ID" },
      "android": { "serviceAccountKeyPath": "./play-store-key.json", "track": "internal" }
    }
  }
}
```

- [ ] **Step 4: Trigger preview builds**

```bash
cd apps/client && eas build --profile preview --platform all
cd ../worker && eas build --profile preview --platform all
```

Expected: builds queue, complete in 15–25 min, install QR codes returned.

- [ ] **Step 5: Smoke test preview builds on physical iOS + Android devices.** Run through full onboarding → post job → receive quote → accept → release → review.

- [ ] **Step 6: Commit**

```bash
git add apps/client/eas.json apps/worker/eas.json
git commit -m "chore(mobile): EAS Build profiles"
```

---

## Task 10: Privacy + legal stubs

**Files:**
- Create: `docs/legal/privacy-policy.md`
- Create: `docs/legal/terms-of-service.md`
- Modify: `apps/client/app/(onboarding)/welcome.tsx` (add ToS/Privacy links)
- Modify: `apps/worker/app/(onboarding)/welcome.tsx`

- [ ] **Step 1: Draft `docs/legal/privacy-policy.md`** covering: data collected (name, phone, location, payment, ID via Persona), purpose, sharing (Stripe, Twilio, Persona, Expo), retention, contact email. Use a generator (Termly / iubenda) — paste output here.

- [ ] **Step 2: Draft `docs/legal/terms-of-service.md`** including the trade self-attestation clause (workers warrant they hold required licenses for their listed trades) and platform-as-marketplace disclaimer.

- [ ] **Step 3: Host on cleansmart.app/privacy and /terms** (out-of-band; static page or marketing site).

- [ ] **Step 4: Add links to welcome screen footer** (both apps)

```tsx
import * as Linking from "expo-linking";
// at bottom of welcome JSX:
<Text style={{ textAlign: "center", color: "#999", fontSize: 12, marginTop: 24 }}>
  By continuing you agree to our{" "}
  <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://cleansmart.app/terms")}>Terms</Text>
  {" "}and{" "}
  <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openURL("https://cleansmart.app/privacy")}>Privacy Policy</Text>.
</Text>
```

- [ ] **Step 5: Commit**

```bash
git add docs/legal apps/client/app/\(onboarding\)/welcome.tsx apps/worker/app/\(onboarding\)/welcome.tsx
git commit -m "chore(legal): privacy and terms with onboarding links"
```

---

## Task 11: Production submission

**Files:** none (all out-of-band).

- [ ] **Step 1: App Store Connect** — create both app records (`com.cleansmart.client`, `com.cleansmart.worker`). Fill metadata from `docs/store/listing-copy.md`, upload screenshots.

- [ ] **Step 2: Google Play Console** — create both apps. Fill metadata, upload screenshots, complete data-safety form citing `docs/legal/privacy-policy.md`.

- [ ] **Step 3: Production builds**

```bash
cd apps/client && eas build --profile production --platform all
cd ../worker && eas build --profile production --platform all
```

- [ ] **Step 4: Submit**

```bash
cd apps/client && eas submit --profile production --platform ios
cd apps/client && eas submit --profile production --platform android
cd ../worker && eas submit --profile production --platform ios
cd ../worker && eas submit --profile production --platform android
```

- [ ] **Step 5: Respond to review feedback** — common asks: demo account credentials, clarification on payments (note Stripe Connect, no in-app crypto), clarification on background location (we don't use it).

---

## Definition of Done

- Both apps install from TestFlight + Play internal track and run end-to-end without crashes.
- Onboarding completes in under 3 minutes for client, under 10 minutes for worker (Stripe + Persona dominate).
- All main screens have empty states, loading states, and friendly error messages.
- Push notifications open the correct screen on tap.
- Privacy policy and ToS reachable from welcome screen.
- Both apps submitted to App Store and Play Store; review status: Waiting for Review or later.
