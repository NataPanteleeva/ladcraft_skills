#!/usr/bin/env python3
"""CLI: JSON stdin → SSH exec via paramiko → JSON stdout."""
from __future__ import annotations

import io
import json
import sys
from typing import Any

import paramiko


def load_private_key(key_text: str) -> paramiko.PKey:
	key_file = io.StringIO(key_text)
	classes = (
		paramiko.Ed25519Key,
		paramiko.RSAKey,
		paramiko.ECDSAKey,
		paramiko.DSSKey,
	)
	last_error: Exception | None = None
	for cls in classes:
		key_file.seek(0)
		try:
			return cls.from_private_key(key_file)
		except Exception as err:  # noqa: BLE001
			last_error = err
	raise ValueError(f"unsupported private key: {last_error}")


def exec_ssh(payload: dict[str, Any]) -> dict[str, Any]:
	host = str(payload.get("host", "")).strip()
	username = str(payload.get("username", "")).strip()
	command = str(payload.get("command", "")).strip()
	port = int(payload.get("port", 22) or 22)
	timeout = int(payload.get("timeoutSeconds", 60) or 60)

	if not host or not username or not command:
		return {"ok": False, "error": "host, username и command обязательны"}

	password = payload.get("password")
	private_key = payload.get("privateKey")

	client = paramiko.SSHClient()
	client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

	connect_kwargs: dict[str, Any] = {
		"hostname": host,
		"port": port,
		"username": username,
		"timeout": min(timeout, 120),
		"allow_agent": False,
		"look_for_keys": False,
	}

	if isinstance(private_key, str) and private_key.strip():
		connect_kwargs["pkey"] = load_private_key(private_key.strip())
	elif isinstance(password, str) and password:
		connect_kwargs["password"] = password
	else:
		return {"ok": False, "error": "password или privateKey обязателен"}

	try:
		client.connect(**connect_kwargs)
		_, stdout, stderr = client.exec_command(command, timeout=timeout)
		exit_code = stdout.channel.recv_exit_status()
		out = stdout.read().decode("utf-8", errors="replace")
		err = stderr.read().decode("utf-8", errors="replace")
		return {
			"ok": True,
			"exitCode": exit_code,
			"stdout": out,
			"stderr": err,
		}
	except Exception as err:  # noqa: BLE001
		return {"ok": False, "error": str(err)}
	finally:
		client.close()


def main() -> None:
	try:
		payload = json.load(sys.stdin)
	except json.JSONDecodeError:
		print(json.dumps({"ok": False, "error": "invalid JSON on stdin"}))
		return
	if not isinstance(payload, dict):
		print(json.dumps({"ok": False, "error": "payload must be object"}))
		return
	print(json.dumps(exec_ssh(payload), ensure_ascii=False))


if __name__ == "__main__":
	main()
