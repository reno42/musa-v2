const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function assertHarnessAccess(sb, auth, userId, { taskId, sessionId } = {}, canAccessWorkspace) {
  const accountId = UUID_RE.test(userId || "") ? userId : null;
  let session = null;
  if (sessionId) {
    const { data, error } = await sb.from("harness_sessions")
      .select("id, account_id, task_id, agent_name, role, status, started_at, ended_at")
      .eq("id", sessionId).maybeSingle();
    if (error) throw { code: -32000, message: "Session lookup failed: " + error.message };
    if (!data) throw { code: -32000, message: "Session not found: " + sessionId };
    session = data;
    taskId ||= data.task_id;
    if (auth?.authType !== "workspace_key" && !auth?.isAdmin && data.account_id && data.account_id !== accountId) {
      throw { code: -32003, message: "Harness session belongs to a different account" };
    }
  }
  if (!taskId) throw { code: -32602, message: "Harness access check requires taskId or sessionId" };
  const { data: task, error } = await sb.from("design_kanban_tasks")
    .select("id, account_id, workspace_id, status, updated_at, completed_at")
    .eq("id", taskId).maybeSingle();
  if (error) throw { code: -32000, message: "Task lookup failed: " + error.message };
  if (!task) throw { code: -32000, message: "Task not found: " + taskId };
  if (auth?.authType === "workspace_key") {
    if (!auth.workspaceId || task.workspace_id !== auth.workspaceId) {
      throw { code: -32003, message: "Harness task is outside the API key workspace" };
    }
  } else if (!auth?.isAdmin) {
    if (task.account_id && task.account_id !== accountId) {
      throw { code: -32003, message: "Harness task belongs to a different account" };
    }
    if (!task.account_id && (!task.workspace_id || typeof canAccessWorkspace !== "function" || !(await canAccessWorkspace(auth, task.workspace_id)))) {
      throw { code: -32003, message: "Harness task workspace is not accessible to this user" };
    }
  }
  return { accountId, session, task };
}

export function selectLatestReviewSubmission(sessions = [], entries = []) {
  const session = sessions
    .filter(candidate => candidate?.role === "implementer" && candidate?.status === "completed" && Number.isFinite(new Date(candidate?.ended_at).getTime()))
    .sort((left, right) => new Date(right.ended_at).getTime() - new Date(left.ended_at).getTime())[0];
  if (!session) return null;
  return entries
    .filter(entry => entry?.entry_type === "review" && entry?.session_id === session.id && entry?.created_at)
    .map(entry => {
      const entryTime = new Date(entry.created_at).getTime();
      const endedTime = new Date(session.ended_at).getTime();
      if (!Number.isFinite(entryTime) || !Number.isFinite(endedTime)) return null;
      const reviewCycleAt = new Date(Math.max(entryTime, endedTime)).toISOString();
      return { session, entry, reviewCycleAt };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.reviewCycleAt).getTime() - new Date(left.reviewCycleAt).getTime())[0] || null;
}
