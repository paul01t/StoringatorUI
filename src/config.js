const encryptOnDeviceSetting = import.meta.env.VITE_ENCRYPT_ON_DEVICE

if (
  encryptOnDeviceSetting !== undefined &&
  encryptOnDeviceSetting !== 'true' &&
  encryptOnDeviceSetting !== 'false'
) {
  throw new Error('VITE_ENCRYPT_ON_DEVICE must be either "true" or "false".')
}

export const ENCRYPT_ON_DEVICE = encryptOnDeviceSetting !== 'false'
