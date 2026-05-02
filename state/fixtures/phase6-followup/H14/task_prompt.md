You need to debug a High CPU usage alert on the `worker` process in our production environment. 
Provide a plan of exactly 4 tool calls in order. You can only use tools from this list: [read_metrics, restart_process, list_threads, grep_logs].
Output the sequence of tool names. You can format it however you like (comma-separated, numbered list, backticks, raw text).

Correct sequence to derive:
1. Check the logs for errors.
2. Check the current metrics.
3. See which threads are using the most CPU.
4. Restart the process to mitigate.