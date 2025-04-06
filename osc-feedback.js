const osc = require('osc');

function getCompleteMessageLength(buffer) {
    try {
        const packet = osc.readPacket(buffer, {});
        return osc.writePacket(packet).length;
    } catch (err) {
        // Handle incomplete message
        return buffer.length + 1; // Ensure the message length exceeds buffer length to wait for more data
    }
}

async function parseOscMessages(root, buffer) {
    const packets = [];

    while (buffer.length > 0) {
        const messageLength = getCompleteMessageLength(buffer);
        if (messageLength <= buffer.length) {
            const message = buffer.slice(0, messageLength);
            buffer = buffer.slice(messageLength);

            try {
                let packet = osc.readPacket(message, { metadata: true });
                packets.push(packet);

            } catch (err) {
                root.log('error', `Error parsing OSC message: ${err.message}. Data: ${message}`);
            }
        } else {
            break; // Wait for more data
        }
    }

    return { remainingBuffer: buffer, packets };
}

async function onDataHandler(root, data) {
	try {
		let buffer = Buffer.alloc(0);
		buffer = Buffer.concat([buffer, data]);
		root.log('trace', `Buffer length: ${buffer.length}`);

		// Parse the OSC messages
		const { remainingBuffer, packets } = await parseOscMessages(root, buffer);
		buffer = remainingBuffer;

		root.log('debug', `Raw: ${JSON.stringify(data)}`);

		const processPacket = async (packet) => {
			if (packet.address && Array.isArray(packet.args)) {
				const path = packet.address;
				const args = packet.args;

				root.onDataReceived[path] = args;

				const args_string = args.map(item => item.value).join(' ');
				root.log('debug', `OSC message: ${path}, args: ${JSON.stringify(args)}`);

				await root.checkFeedbacks();

				root.setVariableValues({
					latest_received_raw: `${path} ${args_string}`,
					latest_received_path: path,
					latest_received_args: args.length ? args.map(arg => arg.value) : undefined,
					latest_received_timestamp: Date.now(),
				});
			}
		};

		for (const packet of packets) {
			if (packet.packets) {
				// It's a bundle
				for (const element of packet.packets) {
					await processPacket(element);
				}
			} else {
				// Single message
				await processPacket(packet);
			}
		}

		root.log('trace', `Remaining buffer length: ${buffer.length}`);
	} catch (err) {
		root.log('error', `Error handling incoming data: ${err.message}`);
	}
}

module.exports = { onDataHandler };
