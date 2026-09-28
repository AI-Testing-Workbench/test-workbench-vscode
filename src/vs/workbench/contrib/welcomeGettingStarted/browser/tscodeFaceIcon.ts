/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// test-workbench_change - new file
// Shared TestAgent mascot face SVGs used by the TSCode welcome page and the
// Agents window composer brand mark.

export const TSCODE_FACE_TYPES = ['default', 'happy', 'surprised', 'shy', 'confused', 'smug', 'bounce', 'love'];

/**
 * Picks a face type using the same timestamp-seeded randomness the welcome page
 * has always used.
 */
export function pickRandomTscodeFaceType(): string {
	return TSCODE_FACE_TYPES[Math.floor((Math.random() * Date.now()) % TSCODE_FACE_TYPES.length)];
}

export function createTscodeFaceSvg(faceType: string, sizePx: number = 80): SVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '-2 -2 28 28');
	svg.setAttribute('style', `width:${sizePx}px;height:${sizePx}px;overflow:visible;vertical-align:middle;display:inline-block;`);

	// Create defs
	const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

	// Create gradient
	const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
	gradient.setAttribute('id', 'bg-tscode-' + faceType);
	gradient.setAttribute('x1', '0%');
	gradient.setAttribute('y1', '0%');
	gradient.setAttribute('x2', '100%');
	gradient.setAttribute('y2', '100%');

	const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	stop1.setAttribute('offset', '0%');
	stop1.setAttribute('stop-color', '#4fc3f7');
	gradient.appendChild(stop1);

	const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	stop2.setAttribute('offset', '50%');
	stop2.setAttribute('stop-color', '#2979ff');
	gradient.appendChild(stop2);

	const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	stop3.setAttribute('offset', '100%');
	stop3.setAttribute('stop-color', '#69f0ae');
	gradient.appendChild(stop3);

	defs.appendChild(gradient);

	// Add blink animation for default face
	if (faceType === 'default') {
		const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
		style.textContent = `
			@keyframes blink-tscode {
				0%, 88%, 100% { ry: 2.62; }
				93% { ry: 0.2; }
			}
			.can-blink-tscode { animation: blink-tscode 4s ease-in-out infinite; }
		`;
		defs.appendChild(style);
	}

	svg.appendChild(defs);

	// Create background circle
	const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	bgCircle.setAttribute('cx', '12');
	bgCircle.setAttribute('cy', '12');
	bgCircle.setAttribute('r', '12');
	bgCircle.setAttribute('fill', '#e8f4ff');
	svg.appendChild(bgCircle);

	// Create border ring
	const borderRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	borderRing.setAttribute('cx', '12');
	borderRing.setAttribute('cy', '12');
	borderRing.setAttribute('r', '12.75');
	borderRing.setAttribute('fill', 'none');
	borderRing.setAttribute('stroke', 'url(#bg-tscode-' + faceType + ')');
	borderRing.setAttribute('stroke-width', '1.5');
	svg.appendChild(borderRing);

	// Add face-specific features
	switch (faceType) {
		case 'default':
			// Default: vertical ellipse eyes with blink
			const leftEyeDefault = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			leftEyeDefault.setAttribute('class', 'can-blink-tscode');
			leftEyeDefault.setAttribute('cx', '8');
			leftEyeDefault.setAttribute('cy', '9.33');
			leftEyeDefault.setAttribute('rx', '1.63');
			leftEyeDefault.setAttribute('ry', '2.62');
			leftEyeDefault.setAttribute('fill', '#2979ff');
			svg.appendChild(leftEyeDefault);

			const rightEyeDefault = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			rightEyeDefault.setAttribute('class', 'can-blink-tscode');
			rightEyeDefault.setAttribute('cx', '16');
			rightEyeDefault.setAttribute('cy', '9.33');
			rightEyeDefault.setAttribute('rx', '1.63');
			rightEyeDefault.setAttribute('ry', '2.62');
			rightEyeDefault.setAttribute('fill', '#2979ff');
			svg.appendChild(rightEyeDefault);
			break;

		case 'happy':
			// Happy: curved arc eyes (^_^)
			const leftArcHappy = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			leftArcHappy.setAttribute('d', 'M6.5 10.5 Q8 8.2 9.5 10.5');
			leftArcHappy.setAttribute('stroke', '#2979ff');
			leftArcHappy.setAttribute('stroke-width', '1.4');
			leftArcHappy.setAttribute('fill', 'none');
			leftArcHappy.setAttribute('stroke-linecap', 'round');
			svg.appendChild(leftArcHappy);

			const rightArcHappy = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			rightArcHappy.setAttribute('d', 'M14.5 10.5 Q16 8.2 17.5 10.5');
			rightArcHappy.setAttribute('stroke', '#2979ff');
			rightArcHappy.setAttribute('stroke-width', '1.4');
			rightArcHappy.setAttribute('fill', 'none');
			rightArcHappy.setAttribute('stroke-linecap', 'round');
			svg.appendChild(rightArcHappy);
			break;

		case 'surprised':
			// Surprised: large round eyes with highlights
			const leftEyeSurprised = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			leftEyeSurprised.setAttribute('cx', '8');
			leftEyeSurprised.setAttribute('cy', '9.5');
			leftEyeSurprised.setAttribute('r', '2.2');
			leftEyeSurprised.setAttribute('fill', '#2979ff');
			svg.appendChild(leftEyeSurprised);

			const rightEyeSurprised = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			rightEyeSurprised.setAttribute('cx', '16');
			rightEyeSurprised.setAttribute('cy', '9.5');
			rightEyeSurprised.setAttribute('r', '2.2');
			rightEyeSurprised.setAttribute('fill', '#2979ff');
			svg.appendChild(rightEyeSurprised);

			// Highlights
			const leftHighlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			leftHighlight.setAttribute('cx', '9.7');
			leftHighlight.setAttribute('cy', '8.8');
			leftHighlight.setAttribute('r', '0.7');
			leftHighlight.setAttribute('fill', 'rgba(255,255,255,0.7)');
			svg.appendChild(leftHighlight);

			const rightHighlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			rightHighlight.setAttribute('cx', '15.7');
			rightHighlight.setAttribute('cy', '8.8');
			rightHighlight.setAttribute('r', '0.7');
			rightHighlight.setAttribute('fill', 'rgba(255,255,255,0.7)');
			svg.appendChild(rightHighlight);
			break;

		case 'bounce':
			// allow-any-unicode-next-line
			// Bounce: happy face (欢跳表情)
			const leftArcBounce = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			leftArcBounce.setAttribute('d', 'M6.5 10.5 Q8 8.2 9.5 10.5');
			leftArcBounce.setAttribute('stroke', '#2979ff');
			leftArcBounce.setAttribute('stroke-width', '1.4');
			leftArcBounce.setAttribute('fill', 'none');
			leftArcBounce.setAttribute('stroke-linecap', 'round');
			svg.appendChild(leftArcBounce);

			const rightArcBounce = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			rightArcBounce.setAttribute('d', 'M14.5 10.5 Q16 8.2 17.5 10.5');
			rightArcBounce.setAttribute('stroke', '#2979ff');
			rightArcBounce.setAttribute('stroke-width', '1.4');
			rightArcBounce.setAttribute('fill', 'none');
			rightArcBounce.setAttribute('stroke-linecap', 'round');
			svg.appendChild(rightArcBounce);
			break;

		case 'love':
			// allow-any-unicode-next-line
			// Love: smiling eyes with blush and floating hearts (爱你表情)
			const leftArcLove = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			leftArcLove.setAttribute('d', 'M6.5 10.5 Q8 8.2 9.5 10.5');
			leftArcLove.setAttribute('stroke', '#2979ff');
			leftArcLove.setAttribute('stroke-width', '1.4');
			leftArcLove.setAttribute('fill', 'none');
			leftArcLove.setAttribute('stroke-linecap', 'round');
			svg.appendChild(leftArcLove);

			const rightArcLove = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			rightArcLove.setAttribute('d', 'M14.5 10.5 Q16 8.2 17.5 10.5');
			rightArcLove.setAttribute('stroke', '#2979ff');
			rightArcLove.setAttribute('stroke-width', '1.4');
			rightArcLove.setAttribute('fill', 'none');
			rightArcLove.setAttribute('stroke-linecap', 'round');
			svg.appendChild(rightArcLove);

			// Blush
			const leftBlushLove = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			leftBlushLove.setAttribute('cx', '7');
			leftBlushLove.setAttribute('cy', '13');
			leftBlushLove.setAttribute('rx', '2.2');
			leftBlushLove.setAttribute('ry', '1.2');
			leftBlushLove.setAttribute('fill', 'rgba(255,107,157,0.4)');
			svg.appendChild(leftBlushLove);

			const rightBlushLove = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			rightBlushLove.setAttribute('cx', '17');
			rightBlushLove.setAttribute('cy', '13');
			rightBlushLove.setAttribute('rx', '2.2');
			rightBlushLove.setAttribute('ry', '1.2');
			rightBlushLove.setAttribute('fill', 'rgba(255,107,157,0.4)');
			svg.appendChild(rightBlushLove);

			// Heart gradient
			const heartGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
			heartGrad.setAttribute('id', 'heartGrad-tscode');
			heartGrad.setAttribute('x1', '0%');
			heartGrad.setAttribute('y1', '0%');
			heartGrad.setAttribute('x2', '100%');
			heartGrad.setAttribute('y2', '100%');
			const heartStop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
			heartStop1.setAttribute('offset', '0%');
			heartStop1.setAttribute('stop-color', '#ff6b9d');
			const heartStop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
			heartStop2.setAttribute('offset', '100%');
			heartStop2.setAttribute('stop-color', '#ff1744');
			heartGrad.appendChild(heartStop1);
			heartGrad.appendChild(heartStop2);
			defs.appendChild(heartGrad);

			// Heart animation
			const heartStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
			heartStyle.textContent = `
				@keyframes heart-float-tscode {
					0% { transform: translate(0, 0) scale(0.8); opacity: 0; }
					20% { opacity: 1; }
					100% { transform: translate(2px, -12px) scale(1.1); opacity: 0; }
				}
				.love-heart-tscode { animation: heart-float-tscode 2s ease-out infinite; transform-origin: 20px 6px; }
			`;
			defs.appendChild(heartStyle);

			// Floating heart
			const heartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			heartGroup.setAttribute('class', 'love-heart-tscode');
			const heartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			heartPath.setAttribute('d', 'M20 6 Q20 4.5 21.2 4.5 Q22.4 4.5 22.4 6 Q22.4 7.5 20 9 Q17.6 7.5 17.6 6 Q17.6 4.5 18.8 4.5 Q20 4.5 20 6 Z');
			heartPath.setAttribute('fill', 'url(#heartGrad-tscode)');
			heartGroup.appendChild(heartPath);
			svg.appendChild(heartGroup);
			break;

		case 'shy':
			// Shy: small dot eyes with blush
			const leftEyeShy = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			leftEyeShy.setAttribute('cx', '8');
			leftEyeShy.setAttribute('cy', '10');
			leftEyeShy.setAttribute('r', '1.4');
			leftEyeShy.setAttribute('fill', '#2979ff');
			svg.appendChild(leftEyeShy);

			const rightEyeShy = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			rightEyeShy.setAttribute('cx', '16');
			rightEyeShy.setAttribute('cy', '10');
			rightEyeShy.setAttribute('r', '1.4');
			rightEyeShy.setAttribute('fill', '#2979ff');
			svg.appendChild(rightEyeShy);

			// Blush
			const leftBlush = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			leftBlush.setAttribute('cx', '7');
			leftBlush.setAttribute('cy', '13');
			leftBlush.setAttribute('rx', '2.2');
			leftBlush.setAttribute('ry', '1.2');
			leftBlush.setAttribute('fill', 'rgba(100,180,255,0.35)');
			svg.appendChild(leftBlush);

			const rightBlush = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			rightBlush.setAttribute('cx', '17');
			rightBlush.setAttribute('cy', '13');
			rightBlush.setAttribute('rx', '2.2');
			rightBlush.setAttribute('ry', '1.2');
			rightBlush.setAttribute('fill', 'rgba(100,180,255,0.35)');
			svg.appendChild(rightBlush);
			break;

		case 'confused':
			// Confused: one eye large, one eye small
			const leftEyeConfused = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			leftEyeConfused.setAttribute('cx', '8');
			leftEyeConfused.setAttribute('cy', '9.33');
			leftEyeConfused.setAttribute('rx', '2.1');
			leftEyeConfused.setAttribute('ry', '2.9');
			leftEyeConfused.setAttribute('fill', '#2979ff');
			svg.appendChild(leftEyeConfused);

			const rightEyeConfused = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
			rightEyeConfused.setAttribute('cx', '16');
			rightEyeConfused.setAttribute('cy', '9.33');
			rightEyeConfused.setAttribute('rx', '1.0');
			rightEyeConfused.setAttribute('ry', '1.6');
			rightEyeConfused.setAttribute('fill', '#2979ff');
			svg.appendChild(rightEyeConfused);
			break;

		case 'smug':
			// Smug: squinting eyes (horizontal lines)
			const leftLineSmug = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			leftLineSmug.setAttribute('x1', '6.2');
			leftLineSmug.setAttribute('y1', '9.33');
			leftLineSmug.setAttribute('x2', '9.8');
			leftLineSmug.setAttribute('y2', '9.33');
			leftLineSmug.setAttribute('stroke', '#2979ff');
			leftLineSmug.setAttribute('stroke-width', '1.5');
			leftLineSmug.setAttribute('stroke-linecap', 'round');
			svg.appendChild(leftLineSmug);

			const rightLineSmug = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			rightLineSmug.setAttribute('x1', '14.2');
			rightLineSmug.setAttribute('y1', '9.33');
			rightLineSmug.setAttribute('x2', '17.8');
			rightLineSmug.setAttribute('y2', '9.33');
			rightLineSmug.setAttribute('stroke', '#2979ff');
			rightLineSmug.setAttribute('stroke-width', '1.5');
			rightLineSmug.setAttribute('stroke-linecap', 'round');
			svg.appendChild(rightLineSmug);
			break;
	}

	return svg;
}
