require("../config.js");
const chalk = require("chalk");
const fs = require("fs");

module.exports = {
ai: {
  key: {
    remoteJid: '13135550002@s.whatsapp.net',
    fromMe: false,
    participant: '13135550002@s.whatsapp.net'
  },
  message: {
      extendedTextMessage: {
      text: 'Powered by Vanzx'
      }
  }
}, 
channel: {
  key: {
    remoteJid: 'status@broadcast',
    fromMe: false,
    participant: '0@s.whatsapp.net'
  },
  message: {
    newsletterAdminInviteMessage: {
      newsletterJid: '123@newsletter',
      caption: `Powered By ${global.namaOwner}.`,
      inviteExpiration: 0
    }
  }
}
}

let file = require.resolve(__filename) 
fs.watchFile(file, () => {
fs.unwatchFile(file)
console.log(chalk.white("⚠︎ Update"), chalk.white(`${__filename}\n`))
delete require.cache[file]
require(file)
})