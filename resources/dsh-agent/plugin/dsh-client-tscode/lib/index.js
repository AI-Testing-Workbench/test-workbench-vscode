// dsh-client-tscode host half: no-op.
// The bridge is implemented entirely in the browser half because the embedded
// window's preload owns the IPC boundary.
export const name = 'dsh-client-tscode'

export const inject = []

export function apply(_ctx) {}
