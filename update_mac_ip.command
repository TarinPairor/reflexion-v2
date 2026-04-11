#!/bin/bash
# Helper script — updates the Pi's MAC_IP setting to match this Mac's IP on the hotspot.
# Run this once on a new Mac before starting sessions.

echo ""
echo "=============================="
echo "   Reflexion — Update IP"
echo "=============================="
echo ""
echo "This will tell the Reflexion device what IP address your Mac is on."
echo ""
echo "Make sure:"
echo "  1. Your Mac is connected to your phone hotspot"
echo "  2. The Reflexion device (Pi) is powered on"
echo ""
read -p "Press Enter when ready..."
echo ""

# Get this Mac's IP on the hotspot
MAC_IP=$(ipconfig getifaddr en0 2>/dev/null)

if [ -z "$MAC_IP" ]; then
    echo "ERROR: Could not find your Mac's IP address."
    echo ""
    echo "Make sure your Mac is connected to your phone hotspot (not normal WiFi)"
    echo "and try again."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "Your Mac's IP address is: $MAC_IP"
echo ""
echo "Connecting to the Reflexion device..."
echo ""

# SSH into Pi and update the MAC_IP in .env
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no pi@reflexion.local \
    "sed -i 's/^MAC_IP=.*/MAC_IP=$MAC_IP/' ~/.env && echo 'Updated successfully'"

if [ $? -eq 0 ]; then
    echo ""
    echo "=============================="
    echo "   Done!"
    echo "=============================="
    echo ""
    echo "The Reflexion device now knows your Mac's IP ($MAC_IP)."
    echo "You can now run start.command to begin a session."
    echo ""
else
    echo ""
    echo "ERROR: Could not connect to the Reflexion device."
    echo ""
    echo "Make sure:"
    echo "  - The device is powered on (green light on)"
    echo "  - Your Mac and the device are both on the same hotspot"
    echo "  - Wait 30 seconds after powering on before trying again"
    echo ""
fi

read -p "Press Enter to close..."
