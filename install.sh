sudo amdgpu-install --usecase=rocm,hiplibsdk,opencl,graphics,multimedia,rocm,rocmdev --no-dkms
sudo usermod -aG render,video $USER
sudo usermod -aG render,video dev

