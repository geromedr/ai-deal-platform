for (const action of parsed.actions) {

  if (action.action === "task_create") {

    const { error } = await supabase
      .from("tasks")
      .insert({
        deal_id,
        title: action.details.title,
        description: action.details.description,
        assigned_to: action.details.assigned_to,
        due_date: action.details.due_date,
        status: "open"
      })

    results.push({ action: "task_create", success: !error })
  }

  if (action.action === "log_communication") {

    const { error } = await supabase
      .from("communications")
      .insert({
        deal_id,
        sender: action.details.sender,
        subject: action.details.subject,
        message_summary: action.details.message_summary,
        sent_at: action.details.received_at
      })

    results.push({ action: "log_communication", success: !error })
  }

  if (action.action === "deal_stage_update") {

    const { error } = await supabase
      .from("deals")
      .update({ stage: action.details.stage })
      .eq("id", deal_id)

    results.push({ action: "deal_stage_update", success: !error })
  }

  if (action.action === "risk_log") {

    const { error } = await supabase
      .from("risks")
      .insert({
        deal_id,
        title: action.details.title,
        description: action.details.description,
        severity: action.details.severity
      })

    results.push({ action: "risk_log", success: !error })
  }

  if (action.action === "financial_snapshot_add") {

    const { error } = await supabase
      .from("financial_snapshots")
      .insert({
        deal_id,
        category: action.details.category,
        amount: action.details.amount,
        notes: action.details.notes
      })

    results.push({ action: "financial_snapshot_add", success: !error })
  }

  if (action.action === "milestone_create") {

    const { error } = await supabase
      .from("milestones")
      .insert({
        deal_id,
        title: action.details.title,
        due_date: action.details.due_date,
        status: "pending"
      })

    results.push({ action: "milestone_create", success: !error })
  }

}