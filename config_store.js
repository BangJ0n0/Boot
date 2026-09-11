const settingPanel = {
  "1gb": { ram: "1GB", cpu: "40%", disk: "10GB", price: 1000 },
  "2gb": { ram: "2GB", cpu: "60%", disk: "20GB", price: 2000 },
  "3gb": { ram: "3GB", cpu: "80%", disk: "30GB", price: 3000 },
  "4gb": { ram: "4GB", cpu: "100%", disk: "40GB", price: 4000 },
  "5gb": { ram: "5GB", cpu: "120%", disk: "50GB", price: 5000 },
  "unlimited": { ram: "Unlimited", cpu: "∞", disk: "Unlimited", price: 7000 }
};

const settingsVps = {
  "r1c1": { ram: "1GB", cpu: "1 vCPU", disk: "25GB SSD", price: 5000, size: "s-1vcpu-1gb" },
  "r2c1": { ram: "2GB", cpu: "1 vCPU", disk: "50GB SSD", price: 10000, size: "s-1vcpu-2gb" },
  "r2c2": { ram: "2GB", cpu: "2 vCPU", disk: "60GB SSD", price: 15000, size: "s-2vcpu-2gb" },
  "r4c2": { ram: "4GB", cpu: "2 vCPU", disk: "80GB SSD", price: 20000, size: "s-2vcpu-4gb" },
  "r8c4": { ram: "8GB", cpu: "4 vCPU", disk: "160GB SSD", price: 25000, size: "s-4vcpu-8gb" },
  "r16c4": { ram: "16GB", cpu: "4 vCPU", disk: "320GB SSD", price: 30000, size: "s-4vcpu-16gb-amd" },
  "r16c8": { ram: "16GB", cpu: "8 vCPU", disk: "400GB SSD", price: 45000, size: "s-8vcpu-16gb-amd" },
  "r32c8": { ram: "32GB", cpu: "8 vCPU", disk: "640GB SSD", price: 65000, size: "s-8vcpu-32gb-amd" }
};

const settingAdp = 20000;

module.exports = { settingPanel, settingsVps, settingAdp };
