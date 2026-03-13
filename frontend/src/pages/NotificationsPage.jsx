import { useEffect, useState, useCallback } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Bell, Check, CheckCheck, Trash2, RefreshCw } from "lucide-react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "../api";

const LEVEL_COLOR = { info: "blue", warning: "yellow", error: "red" };

export default function NotificationsPage() {
  const [data, setData] = useState({ items: [], count: 0, unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getNotifications(200);
      setData(res);
    } catch (e) {
      setError(e.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onMarkRead(id) {
    setBusy(id);
    try {
      await markNotificationRead(id);
      setData((prev) => ({
        ...prev,
        items: prev.items.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
        unread_count: Math.max(0, prev.unread_count - 1),
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function onMarkAllRead() {
    setBusy("all");
    try {
      await markAllNotificationsRead();
      setData((prev) => ({
        ...prev,
        items: prev.items.map((n) => ({ ...n, is_read: true })),
        unread_count: 0,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(id) {
    setBusy(id);
    try {
      await deleteNotification(id);
      setData((prev) => {
        const removed = prev.items.find((n) => n.id === id);
        return {
          items: prev.items.filter((n) => n.id !== id),
          count: prev.count - 1,
          unread_count: removed && !removed.is_read ? prev.unread_count - 1 : prev.unread_count,
        };
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Group gap="sm">
          <Bell size={22} />
          <Title order={2}>Notifications</Title>
          {data.unread_count > 0 && (
            <Badge color="red" variant="filled" size="lg">{data.unread_count}</Badge>
          )}
        </Group>
        <Group gap="xs">
          {data.unread_count > 0 && (
            <Button
              leftSection={<CheckCheck size={16} />}
              variant="light"
              onClick={onMarkAllRead}
              loading={busy === "all"}
              disabled={!!busy && busy !== "all"}
              size="sm"
            >
              Mark all read
            </Button>
          )}
          <Button
            leftSection={<RefreshCw size={16} />}
            variant="subtle"
            onClick={load}
            loading={loading}
            size="sm"
          >
            Refresh
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!loading && data.items.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">No notifications yet.</Text>
      )}

      {data.items.map((n) => (
        <Card
          key={n.id}
          withBorder
          shadow={n.is_read ? undefined : "xs"}
          padding="sm"
          radius="md"
          style={{ opacity: n.is_read ? 0.7 : 1, borderLeft: `4px solid var(--mantine-color-${LEVEL_COLOR[n.level] || "gray"}-5)` }}
        >
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={4} style={{ flex: 1 }}>
              <Group gap="xs">
                <Badge size="xs" color={LEVEL_COLOR[n.level] || "gray"}>{n.level}</Badge>
                <Text fw={n.is_read ? 400 : 600} size="sm">{n.title}</Text>
              </Group>
              <Text size="sm" c="dimmed">{n.message}</Text>
              <Text size="xs" c="dimmed">{new Date(n.created_at).toLocaleString()}</Text>
            </Stack>
            <Group gap={4} wrap="nowrap">
              {!n.is_read && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => onMarkRead(n.id)}
                  loading={busy === n.id}
                  disabled={!!busy && busy !== n.id}
                  title="Mark as read"
                >
                  <Check size={14} />
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => onDelete(n.id)}
                loading={busy === n.id}
                disabled={!!busy && busy !== n.id}
                title="Delete"
              >
                <Trash2 size={14} />
              </Button>
            </Group>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
