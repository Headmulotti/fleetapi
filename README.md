# Fleet MDM Console

A simple internal web UI for support teams to manage MDM devices via `fleetctl`.
No API knowledge required — just click.

## Requirements

- Python 3.8+
- `flask` (`pip install flask`)
- `fleetctl` installed and authenticated on the machine running this server

## Setup

```bash
# 1. Install Flask
pip install flask

# 2. Make sure fleetctl is logged in
fleetctl login

# 3. Run the server
python app.py
```

Then open **http://localhost:5050** in your browser.

## Usage

1. Click **Fetch MDM Hosts** to load all enrolled MDM devices
2. Click devices to select them (multi-select supported)
3. Click a command button to send an MDM action to all selected devices
4. Red/yellow/green risk levels indicate command severity
5. High-risk commands (Erase) require a confirmation dialog

## Adding Custom Commands

1. Drop a new `.xml` file into the `payloads/` folder
2. Register it in `app.py` in the `PAYLOAD_LABELS` dict:

```python
PAYLOAD_LABELS = {
    "my-command.xml": {
        "label": "My Custom Command",
        "icon": "🔧",
        "risk": "medium",   # low / medium / high
        "confirm": True     # show confirmation dialog?
    },
    ...
}
```

3. Restart the server — it will appear in the UI automatically.

## Included Payloads

| File | Action | Risk |
|------|--------|------|
| `restart-device.xml` | Restarts the device | Low |
| `lock-device.xml` | Locks with PIN + message | Medium |
| `clear-passcode.xml` | Removes device PIN | Medium |
| `enable-lost-mode.xml` | Enables Lost Mode (iOS/iPadOS) | Medium |
| `erase-device.xml` | Full device wipe | High |

## Security Notes

- Run this server on an internal network only — it has no authentication built in
- Only serve it to trusted support staff
- The server sanitizes payload file paths to prevent directory traversal
- Consider adding HTTP Basic Auth if exposing beyond localhost
