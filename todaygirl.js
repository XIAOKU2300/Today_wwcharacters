import plugin from '../../lib/plugins/plugin.js';
import { segment } from 'oicq';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// -------------------------------
// 插件目录 & 素材目录
// -------------------------------
const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const wifeResourceDir = path.join(pluginDir, 'custom_role_pile');

// -------------------------------
// 缓存每日老婆 & 请求冷却（改为群聊级别）
// -------------------------------
const todayWifeCache = {};

export class todayGirl extends plugin {
  constructor() {
    super({
      name: '今日老婆',
      dsc: '固定每天的老婆，3秒CD，附每日一言',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#今日老婆$', fnc: 'sendTodayWife' }
      ]
    });
  }

  async sendTodayWife(e) {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    
    // -------------------------------
    // 确定缓存键：群聊用群号，私聊用用户ID
    // -------------------------------
    const cacheKey = e.isGroup ? e.group_id : e.user_id;

    // -------------------------------
    // 3秒冷却（群聊级别或私聊级别）
    // -------------------------------
    if (todayWifeCache[cacheKey]?.lastTime && now - todayWifeCache[cacheKey].lastTime < 3000) {
      await e.reply('等等啦，别太快重复请求~ ⏳');
      return true;
    }

    todayWifeCache[cacheKey] = todayWifeCache[cacheKey] || {};

    // -------------------------------
    // 检查素材目录
    // -------------------------------
    if (!fs.existsSync(wifeResourceDir)) {
      try {
        fs.mkdirSync(wifeResourceDir, { recursive: true });
        await e.reply(`素材目录不存在，已创建：\n${wifeResourceDir}\n请添加角色文件夹和图片`);
      } catch (err) {
        logger.error(`[今日老婆] 创建素材目录失败: ${wifeResourceDir}`);
        logger.error(err);
        await e.reply(`无法创建素材目录，请检查权限：${wifeResourceDir}`);
      }
      return true;
    }

    // -------------------------------
    // 读取角色文件夹
    // -------------------------------
    let roleFolders;
    try {
      const items = await fs.promises.readdir(wifeResourceDir, { withFileTypes: true });
      roleFolders = items
        .filter(item => item.isDirectory())
        .map(item => item.name);
    } catch (err) {
      logger.error(`[今日老婆] 目录读取失败: ${wifeResourceDir}`);
      logger.error(err);
      await e.reply(`哎呀，读取素材目录失败... T_T`);
      return true;
    }

    if (roleFolders.length === 0) {
      await e.reply(`角色文件夹为空，请在 ${wifeResourceDir} 添加角色文件夹`);
      return true;
    }

    // -------------------------------
    // 如果缓存日期不是今天，重新分配角色
    // -------------------------------
    if (todayWifeCache[cacheKey].date !== today) {
      // 随机选择一个角色文件夹
      const randomFolderIndex = Math.floor(Math.random() * roleFolders.length);
      const selectedFolder = roleFolders[randomFolderIndex];
      const folderPath = path.join(wifeResourceDir, selectedFolder);
      
      // 读取该角色文件夹中的所有图片
      let imageFiles;
      try {
        const files = await fs.promises.readdir(folderPath);
        imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
      } catch (err) {
        logger.error(`[今日老婆] 角色文件夹读取失败: ${folderPath}`);
        logger.error(err);
        await e.reply(`角色文件夹读取失败: ${selectedFolder}`);
        return true;
      }
      
      if (imageFiles.length === 0) {
        await e.reply(`角色文件夹 ${selectedFolder} 中没有图片`);
        return true;
      }
      
      // 从文件名中提取角色名称（去掉_后面的部分）
      const roleName = this.extractRoleName(imageFiles[0]);
      
      // 初始化缓存
      todayWifeCache[cacheKey] = {
        date: today,
        roleFolder: selectedFolder,
        roleName: roleName,
        sentImages: [], // 记录已发送的图片
        allImages: imageFiles // 该角色所有图片
      };
    }

    // -------------------------------
    // 选择同一角色目录下的不同照片
    // -------------------------------
    const cache = todayWifeCache[cacheKey];
    let availableImages = cache.allImages.filter(img => !cache.sentImages.includes(img));
    
    // 如果所有图片都已发送过，重置已发送列表
    if (availableImages.length === 0) {
      availableImages = cache.allImages;
      cache.sentImages = [];
    }
    
    // 随机选择一张未发送的图片
    const randomImageIndex = Math.floor(Math.random() * availableImages.length);
    const selectedImage = availableImages[randomImageIndex];
    
    // 记录已发送的图片
    cache.sentImages.push(selectedImage);
    cache.lastTime = now;

    // -------------------------------
    // 获取每日一言
    // -------------------------------
    let yiyanData = null;
    try {
      const res = await fetch('https://v1.hitokoto.cn/?encode=json&charset=utf-8');
      yiyanData = await res.json();
    } catch (err) {
      logger.error('[今日老婆] 获取每日一言失败');
      logger.error(err);
      yiyanData = null;
    }

    // -------------------------------
    // 准备消息（添加艾特功能）
    // -------------------------------
    const imagePath = path.join(wifeResourceDir, cache.roleFolder, selectedImage);

    // 构建消息数组，群聊时先艾特用户
    const msg = [];
    
    if (e.isGroup) {
      // 群聊：先艾特用户
      msg.push(segment.at(e.user_id));
      msg.push('\n');
    } else {
      // 私聊：友好称呼
      msg.push(`亲爱的 ${e.sender.nickname || '小伙伴'}，\n`);
    }

    // 添加主要内容
    msg.push(
      `🌸 今日缘分已为你准备妥当！\n`,
      `✨ 今日老婆：${cache.roleName}\n`,
      segment.image(imagePath)
    );

    // 添加每日一言（如果有数据）
    if (yiyanData) {
      const { hitokoto, from, from_who } = yiyanData;
      
      let yiyanText = `💫 ${hitokoto}`;
      
      // 优雅地处理来源信息
      if (from_who && from) {
        yiyanText += `\n   —— ${from_who} · 《${from}》`;
      } else if (from_who) {
        yiyanText += `\n   —— ${from_who}`;
      } else if (from) {
        yiyanText += `\n   —— 《${from}》`;
      }
      
      msg.push(`\n📝 每日一言：\n${yiyanText}`);
    }

    // -------------------------------
    // 发送消息
    // -------------------------------
    try {
      await e.reply(msg);
    } catch (err) {
      logger.error(`[今日老婆] 图片发送失败: ${imagePath}`);
      logger.error(err);
      await e.reply('呜，图片发送失败了，可能这张图有问题...');
    }

    return true;
  }

  // 从文件名中提取角色名称（去掉_后面的部分）
  extractRoleName(filename) {
    // 去掉文件扩展名
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    
    // 按第一个下划线分割，取第一部分作为角色名
    const parts = nameWithoutExt.split('_');
    return parts[0] || nameWithoutExt;
  }
}