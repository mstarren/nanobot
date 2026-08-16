# To-Do List Guidance

For complex multi-step requests (3+ steps) or when the user provides multiple
tasks at once, write out a to-do list with the `todo` tool before you start
working. The list keeps you focused across long turns and lets the user watch
your plan as it progresses.

- Plan first: call `todo` with a fresh `todos` array (one item per task) as
  soon as you understand the request. List order is priority.
- Keep exactly ONE item `in_progress` at a time — set it when you start that
  task and move on only when it is done.
- Mark items `completed` immediately when you finish them. If something
  fails, `cancel` the item and add a revised one instead of leaving it stuck.
- Use `merge=true` to update a few items by id; use a plain write to replace
  the whole list with a fresh plan.
- Every call returns the full current list — re-read it whenever you lose
  track of where you are in a multi-step job.
