const fs = require("fs");
global.owner = "6288801074059"
global.namaOwner = "wanzofc"
global.prefix = ".";
global.botName = "wanzAsist";
global.pairingNumber = "6288801074059"
global.paircode = "BBBBBBBB"
global.jedaPushkontak = 6000
global.thumbnail = "https://yt3.ggpht.com/muwFxUJNQxfsuK8qLzip0VWKhXt4q-gYsgJy-045x7U2mO9gaa5yikN4YY86w2z83p-weNDQrA=s176-c-k-c0x00ffffff-no-rj-mo"
global.thumbnailReply = "https://yt3.ggpht.com/muwFxUJNQxfsuK8qLzip0VWKhXt4q-gYsgJy-045x7U2mO9gaa5yikN4YY86w2z83p-weNDQrA=s176-c-k-c0x00ffffff-no-rj-mo"

global.idChannel = "120363407635777414"
global.namaChannel = "© wanzofc"
global.linkChannel = "https://whatsapp.com/channel/0029vb7oydd5vka3rqdh561b"
global.linkGrup = "https://chat.whatsapp.com/g5lljf9dcfej5k1c2rab8m?mode=gi_t"

global.apiFyxz = "123"
global.jedaJpm = 2000;
global.apikeyDigitalocean = "xxxx"
global.dana = "6288801074059"
global.ovo = "6288801074059"
global.gopay = "6288801074059"
global.qris = "-"
global.egg = "15";
global.nestid = "5";
global.loc = "1";
global.domain = "https://Fyxzpedia-Git.com";
global.apikey = "ptla_l1Mxkn5XlLHVWorR7EPfsyMtrCAvvZpDWtw1nVP61";   // API PTLA
global.capikey = "ptlc_DGziipsIHGlvFVgZ0OoL0nPFlUErL8kEvKKEyQH9";  // API PTLC

global.mess = {
  owner: "Fitur ini hanya bisa digunakan oleh Vanzx*.",
  premium: "Fitur ini hanya bisa digunakan oleh *User Premium*.",
  group: "Fitur ini hanya dapat digunakan di dalam grup.",
  private: "Fitur ini hanya dapat digunakan di private chat.",
  admin: "Fitur ini hanya bisa digunakan oleh admin grup.",
  botadmin: "Fitur ini hanya dapat digunakan jika bot adalah admin grup.",
};

let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  delete require.cache[file]
  require(file)
})