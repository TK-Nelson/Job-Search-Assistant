import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Anchor,
  Badge,
  Breadcrumbs,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";

import { getFetchRuns } from "../api";

function statusColor(status) {
  if (status === "success") return "teal";
  if (status === "partial_failure") return "yellow";
  if (status === "failure") return "red";
  if (status === "running") return "blue";
  return "gray";
}

/** Format a UTC timestamp to { date: "MMM DD, YYYY", time: "H:MM AM/PM" } */
function formatTimestamp(value) {
  if (!value) return null;
  const d = new Date(value + "Z");
  if (Number.isNaN(d.getTime())) return { date: value, time: "" };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date: `${mon} ${day}, ${year}`, time: `${h12}:${mm} ${ampm}` };
}

function TimestampCell({ value }) {
  const ts = formatTimestamp(value);
  if (!ts) return <Text size="sm" c="dimmed">—</Text>;
  return (
    <div>
      <Text size="sm" style={{ whiteSpace: "nowrap" }}>{ts.date}</Text>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{ts.time}</Text>
    </div>
  );
}

/**
 * Group error strings by company name.
 * Errors are formatted as "CompanyName: message" by the backend.
 */
function groupErrorsByCompany(errors) {
  const map = new Map();
  for (const err of errors) {
    const colonIdx = err.indexOf(": ");
    let company = "Unknown";
    let message = err;
    if (colonIdx > 0) {
      company = err.slice(0, colonIdx);
      message = err.slice(colonIdx + 2);
    }
    if (!map.has(company)) map.set(company, []);
    map.get(company).push(message);
  }
  return map;
}

export default function FetchLogsPage() {
  const [runs, setRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await getFetchRuns(100);
        setRuns(result.items || []);
      } catch {
        /* silent */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Fetch Logs</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
        <Title order={2} mb="md">Fetch Logs</Title>
        <Text c="dimmed" size="sm" mb="md">
          History of all fetch runs. Each run checks followed companies for new job postings.
        </Text>

        <Table.ScrollContainer minWidth={1050}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Run ID</Table.Th>
                <Table.Th style={{ whiteSpace: "nowrap", minWidth: 120 }}>Status</Table.Th>
                <Table.Th style={{ minWidth: 130 }}>Started</Table.Th>
                <Table.Th style={{ minWidth: 130 }}>Completed</Table.Th>
                <Table.Th>Companies</Table.Th>
                <Table.Th>New</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th>
                      <Tooltip label="Links on careers pages that didn't look like job listings (bad URLs, cross-domain, navigation links)" multiline w={280}>
                        <Text size="sm" fw={700} td="underline" style={{ textDecorationStyle: "dotted", cursor: "help" }}>Skipped</Text>
                      </Tooltip>
                    </Table.Th>
                <Table.Th>
                      <Tooltip label="Valid job listings excluded because they didn't match your title/description keyword filters" multiline w={280}>
                        <Text size="sm" fw={700} td="underline" style={{ textDecorationStyle: "dotted", cursor: "help" }}>Filtered</Text>
                      </Tooltip>
                    </Table.Th>
                <Table.Th style={{ minWidth: 220 }}>Errors</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run) => {
                let errors = [];
                try {
                  errors = JSON.parse(run.errors_json || "[]");
                } catch { /* ignore */ }
                const errorsByCompany = groupErrorsByCompany(errors);
                return (
                  <Table.Tr key={run.id}>
                    <Table.Td>{run.id}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(run.status)} variant="light" size="sm" style={{ whiteSpace: "nowrap", minWidth: 95, textAlign: "center" }}>
                        {run.status === "partial_failure" ? "Partial Failure" : run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                      </Badge>
                    </Table.Td>
                    <Table.Td><TimestampCell value={run.started_at} /></Table.Td>
                    <Table.Td><TimestampCell value={run.completed_at} /></Table.Td>
                    <Table.Td>{run.companies_checked}</Table.Td>
                    <Table.Td>
                      {run.postings_new > 0 ? (
                        <Badge color="teal" variant="light" size="sm">{run.postings_new}</Badge>
                      ) : 0}
                    </Table.Td>
                    <Table.Td>{run.postings_updated}</Table.Td>
                    <Table.Td>{run.postings_skipped}</Table.Td>
                    <Table.Td>{run.postings_filtered_out || 0}</Table.Td>
                    <Table.Td>
                      {errors.length > 0 ? (
                        <Stack gap={4}>
                          {[...errorsByCompany.entries()].map(([company, msgs]) => (
                            <Group key={company} gap={6} wrap="nowrap" align="flex-start">
                              <Badge color="red" variant="light" size="xs" style={{ flexShrink: 0 }}>
                                {company}
                              </Badge>
                              <Text size="xs" c="red" lineClamp={2}>
                                {msgs.join("; ")}
                              </Text>
                            </Group>
                          ))}
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={10}><Text c="dimmed">Loading...</Text></Table.Td>
                </Table.Tr>
              )}
              {!isLoading && runs.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={10}><Text c="dimmed" ta="center" py="md">No fetch runs recorded yet.</Text></Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
