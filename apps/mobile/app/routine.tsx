import type { EventDefinition, Routine, Trigger } from "@rakazo/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { glassHeaderOptions } from "../components/glass-title";
import { NativeActionButton } from "../components/native-action-button";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { presentMessageActionSheet } from "../lib/message-action-sheet";
import { native, useMobileTokens, useResolvedAppearance } from "../lib/native";
import { routineStatusLine } from "../lib/routine";
import { errorText } from "../lib/user-error";
export default function RoutineDetail() {
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const { t } = useI18n();
  const { botId, botName, routineId } = useLocalSearchParams<{
    botId?: string;
    botName?: string;
    routineId?: string;
  }>();
  const router = useRouter();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [catalog, setCatalog] = useState<EventDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!botId || !routineId) {
      setError(t("Routine link is incomplete"));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      rpc<Routine[]>("routines/list", { botId }),
      rpc<Trigger[]>("triggers/list", { routineId }),
      rpc<EventDefinition[]>("events/list"),
    ])
      .then(([routines, nextTriggers, nextCatalog]) => {
        if (cancelled) return;
        const match = routines.find((item) => item.id === routineId);
        if (match) setRoutine(match);
        else setError(t("This routine no longer exists"));
        setTriggers(nextTriggers);
        setCatalog(nextCatalog);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(errorText(loadError, t("Could not load routine")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, routineId]);

  function triggerLabel(trigger: Trigger): string {
    const match =
      catalog.find(
        (entry) => entry.provider === trigger.provider && entry.type === trigger.eventType,
      ) ?? catalog.find((entry) => entry.provider === trigger.provider);
    return match?.label ?? `${trigger.provider}${trigger.eventType ? `:${trigger.eventType}` : ""}`;
  }

  async function addTrigger(definition: EventDefinition): Promise<void> {
    if (!routineId) return;
    const field = definition.fields[0] ?? "payload";
    try {
      const created = await rpc<Trigger>("triggers/create", {
        routineId,
        source: definition.source,
        provider: definition.provider,
        eventType: definition.type,
        filter: { predicates: [{ field, operator: "exists", caseSensitive: false }] },
        mappings: [],
        enabled: true,
      });
      setTriggers((current) => [...current, created]);
    } catch (addError) {
      Alert.alert(t("Could not add trigger"), addError instanceof Error ? addError.message : "");
    }
  }

  function pickEvent(): void {
    presentMessageActionSheet({
      actions: catalog.map((definition) => ({
        text: definition.label,
        onPress: () => void addTrigger(definition),
      })),
      title: t("Add trigger"),
      cancel: t("Cancel"),
      more: t("More"),
      colorScheme,
    });
  }

  async function removeTrigger(triggerId: string): Promise<void> {
    try {
      await rpc("triggers/remove", { triggerId });
      setTriggers((current) => current.filter((item) => item.id !== triggerId));
    } catch (removeError) {
      Alert.alert(
        t("Could not remove trigger"),
        removeError instanceof Error ? removeError.message : "",
      );
    }
  }

  function confirmRemove(trigger: Trigger): void {
    Alert.alert(t("Remove trigger"), triggerLabel(trigger), [
      { text: t("Cancel"), style: "cancel" },
      { text: t("Remove"), style: "destructive", onPress: () => void removeTrigger(trigger.id) },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 24, gap: 18 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={glassHeaderOptions(routine?.name ?? t("Routine"))} />
      {loading ? <ActivityIndicator color={tokens.mutedForeground} /> : null}
      {error ? <Text style={{ color: tokens.destructive, fontSize: 15 }}>{error}</Text> : null}
      {routine ? (
        <>
          <View
            style={{
              borderRadius: 16,
              backgroundColor: native.fill,
              padding: 18,
            }}
          >
            <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
              {routineStatusLine(routine)}
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 13, textTransform: "uppercase" }}
            >
              {t("Prompt")}
            </Text>
            <Text
              selectable
              style={{
                color: tokens.foreground,
                fontSize: 15,
                lineHeight: 23,
                borderRadius: 16,
                backgroundColor: native.fill,
                padding: 18,
              }}
            >
              {routine.prompt}
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text
                style={{ color: tokens.mutedForeground, fontSize: 13, textTransform: "uppercase" }}
              >
                {t("Reactive triggers")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Add trigger")}
                hitSlop={10}
                onPress={pickEvent}
              >
                <Text style={{ color: tokens.foreground, fontSize: 22, lineHeight: 24 }}>+</Text>
              </Pressable>
            </View>
            {triggers.length === 0 ? (
              <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
                {t("The routine runs on every matched event.")}
              </Text>
            ) : (
              triggers.map((trigger) => (
                <Pressable
                  key={trigger.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("Remove trigger")}
                  onPress={() => confirmRemove(trigger)}
                  style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: tokens.border,
                    backgroundColor: tokens.card,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                    {triggerLabel(trigger)}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
          <NativeActionButton
            label={t("Open conversation")}
            onPress={() =>
              router.push({
                pathname: "/thread",
                params: { botId: botId ?? "", name: botName ?? t("Bot") },
              })
            }
          />
        </>
      ) : null}
    </ScrollView>
  );
}
