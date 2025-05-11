const Group = require('../models/Group');
const Transaction = require('../models/Transaction');
const Card = require('../models/Card');
const Config = require('../models/Config');
const { formatSmart, formatRateValue, formatTelegramMessage, isTrc20Address, formatDateUS } = require('../utils/formatter');
const { getDepositHistory, getPaymentHistory, getCardSummary } = require('./groupCommands');
const { getButtonsStatus, getInlineKeyboard } = require('./userCommands');
const messages = require('../src/messages/vi');

/**
 * Xử lý lệnh tính toán USDT (/t)
 */
const handleCalculateUsdtCommand = async (bot, msg) => {
  try {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    
    // Phân tích tin nhắn
    const parts = messageText.split('/t ');
    if (parts.length !== 2) {
      bot.sendMessage(chatId, "Cú pháp không hợp lệ. Ví dụ: /t 50000");
      return;
    }
    
    // Lấy số tiền VND
    const amount = parseFloat(parts[1].trim());
    if (isNaN(amount)) {
      bot.sendMessage(chatId, "Số tiền không hợp lệ.");
      return;
    }
    
    // Tìm group
    const group = await Group.findOne({ chatId: chatId.toString() });
    if (!group || !group.exchangeRate || !group.rate) {
      bot.sendMessage(chatId, "Vui lòng thiết lập tỷ giá và tỷ lệ trước.");
      return;
    }
    
    // Tính toán
    const xValue = group.rate;
    const yValue = group.exchangeRate;
    const usdtValue = (amount / yValue) * (1 - xValue / 100);
    
    // Lấy đơn vị tiền tệ
    const configCurrency = await Config.findOne({ key: 'CURRENCY_UNIT' });
    const currencyUnit = configCurrency ? configCurrency.value : 'USDT';
    
    // Gửi kết quả
    bot.sendMessage(
      chatId,
      `🔄 ${formatSmart(amount)} ➡️ ${currencyUnit} ${formatSmart(usdtValue)}\n` +
      `(汇率: ${formatRateValue(yValue)}, 费率: ${formatRateValue(xValue)}%)`
    );
  } catch (error) {
    console.error('Error in handleCalculateUsdtCommand:', error);
    bot.sendMessage(msg.chat.id, messages.errorProcessingMessage);
  }
};

/**
 * Xử lý lệnh tính toán VND (/v)
 */
const handleCalculateVndCommand = async (bot, msg) => {
  try {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    
    // Phân tích tin nhắn
    const parts = messageText.split('/v ');
    if (parts.length !== 2) {
      bot.sendMessage(chatId, "Cú pháp không hợp lệ. Ví dụ: /v 100");
      return;
    }
    
    // Lấy số tiền USDT
    const amount = parseFloat(parts[1].trim());
    if (isNaN(amount)) {
      bot.sendMessage(chatId, "Số tiền không hợp lệ.");
      return;
    }
    
    // Tìm group
    const group = await Group.findOne({ chatId: chatId.toString() });
    if (!group || !group.exchangeRate || !group.rate) {
      bot.sendMessage(chatId, "Vui lòng thiết lập tỷ giá và tỷ lệ trước.");
      return;
    }
    
    // Tính toán
    const xValue = group.rate;
    const yValue = group.exchangeRate;
    const vndValue = (amount / (1 - xValue / 100)) * yValue;
    
    // Lấy đơn vị tiền tệ
    const configCurrency = await Config.findOne({ key: 'CURRENCY_UNIT' });
    const currencyUnit = configCurrency ? configCurrency.value : 'USDT';
    
    // Gửi kết quả
    bot.sendMessage(
      chatId,
      `🔄 ${currencyUnit} ${formatSmart(amount)} ➡️ ${formatSmart(vndValue)}\n` +
      `(汇率: ${formatRateValue(yValue)}, 费率: ${formatRateValue(xValue)}%)`
    );
  } catch (error) {
    console.error('Error in handleCalculateVndCommand:', error);
    bot.sendMessage(msg.chat.id, messages.errorProcessingMessage);
  }
};

/**
 * Xử lý biểu thức toán học
 */
const handleMathExpression = async (bot, chatId, expression, senderName) => {
  try {
    // Tính toán kết quả
    let result;
    try {
      result = eval(expression);
    } catch (error) {
      bot.sendMessage(chatId, "Biểu thức không hợp lệ, vui lòng thử lại.");
      return;
    }
    
    if (isNaN(result)) {
      bot.sendMessage(chatId, "Kết quả tính toán không hợp lệ.");
      return;
    }
    
    // Gửi kết quả
    bot.sendMessage(
      chatId,
      `${expression} = ${formatSmart(result)}`
    );
  } catch (error) {
    console.error('Error in handleMathExpression:', error);
    bot.sendMessage(chatId, messages.errorProcessingMessage);
  }
};

/**
 * Xử lý địa chỉ TRC20
 */
const handleTrc20Address = async (bot, chatId, address, senderName) => {
  try {
    // Gửi kết quả
    bot.sendMessage(
      chatId,
      `🔍 Địa chỉ USDT-TRC20:\n\`${address}\``
    );
  } catch (error) {
    console.error('Error in handleTrc20Address:', error);
    bot.sendMessage(chatId, messages.errorProcessingMessage);
  }
};

/**
 * Xử lý lệnh báo cáo (/report hoặc 结束)
 */
const handleReportCommand = async (bot, chatId, senderName) => {
  try {
    // Tìm group
    const group = await Group.findOne({ chatId: chatId.toString() });
    if (!group) {
      bot.sendMessage(chatId, "Không có dữ liệu khả dụng.");
      return;
    }
    
    // Lấy đơn vị tiền tệ
    const configCurrency = await Config.findOne({ key: 'CURRENCY_UNIT' });
    const currencyUnit = configCurrency ? configCurrency.value : 'USDT';
    
    // Lấy thông tin tất cả các giao dịch trong ngày
    const todayDate = new Date();
    const lastClearDate = group.lastClearDate;
    
    // Lấy tất cả các giao dịch deposit/withdraw
    const depositTransactions = await Transaction.find({
      chatId: chatId.toString(),
      type: { $in: ['deposit', 'withdraw'] },
      timestamp: { $gt: lastClearDate },
      skipped: { $ne: true }
    }).sort({ timestamp: 1 });
    
    // Lấy tất cả các giao dịch payment
    const paymentTransactions = await Transaction.find({
      chatId: chatId.toString(),
      type: 'payment',
      timestamp: { $gt: lastClearDate },
      skipped: { $ne: true }
    }).sort({ timestamp: 1 });
    
    // Format dữ liệu giao dịch deposit
    const depositEntries = depositTransactions.map((t, index) => {
      return {
        id: index + 1,
        details: t.details,
        messageId: t.messageId || null,
        chatLink: t.messageId ? `https://t.me/c/${chatId.toString().replace('-100', '')}/${t.messageId}` : null,
        timestamp: t.timestamp,
        senderName: t.senderName || ''
      };
    });
    
    // Format dữ liệu giao dịch payment
    const paymentEntries = paymentTransactions.map((t, index) => {
      return {
        id: index + 1,
        details: t.details,
        messageId: t.messageId || null,
        chatLink: t.messageId ? `https://t.me/c/${chatId.toString().replace('-100', '')}/${t.messageId}` : null,
        timestamp: t.timestamp,
        senderName: t.senderName || ''
      };
    });
    
    // Lấy thông tin thẻ
    const cardSummary = await getCardSummary(chatId);
    
    // Tạo response JSON với tất cả giao dịch
    const responseData = {
      date: formatDateUS(todayDate),
      depositData: { 
        entries: depositEntries, 
        totalCount: depositEntries.length 
      },
      paymentData: { 
        entries: paymentEntries, 
        totalCount: paymentEntries.length 
      },
      rate: formatRateValue(group.rate) + "%",
      exchangeRate: formatRateValue(group.exchangeRate),
      totalAmount: formatSmart(group.totalVND),
      totalUSDT: formatSmart(group.totalUSDT),
      paidUSDT: formatSmart(group.usdtPaid),
      remainingUSDT: formatSmart(group.remainingUSDT),
      currencyUnit,
      cards: cardSummary
    };
    
    // Format và gửi tin nhắn
    const response = formatTelegramMessage(responseData);
    
    // Kiểm tra trạng thái hiển thị buttons
    const showButtons = await getButtonsStatus(chatId);
    const keyboard = showButtons ? await getInlineKeyboard(chatId) : null;
    
    bot.sendMessage(chatId, response, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
  } catch (error) {
    console.error('Error in handleReportCommand:', error);
    bot.sendMessage(chatId, messages.errorProcessingMessage);
  }
};

/**
 * Xử lý lệnh trợ giúp (/help)
 */
const handleHelpCommand = async (bot, chatId) => {
  try {
    const helpMessage = `
*Hướng dẫn sử dụng Bot*

*Lệnh cơ bản:*
/start - Bắt đầu sử dụng bot
/help - Hiển thị hướng dẫn này
/off - Kết thúc phiên làm việc

*Lệnh chuyển đổi tiền tệ:*
/t [số] - Chuyển đổi VND sang USDT
/v [số] - Chuyển đổi USDT sang VND

*Lệnh quản lý:*
/m [đơn vị] - Đặt đơn vị tiền tệ (VND/USDT)
/d [tỷ lệ] - Đặt tỷ lệ và tỷ giá
/x [ID] - Ẩn thẻ
/sx [ID] - Hiện thẻ
/hiddenCards - Xem danh sách thẻ ẩn
/delete [ID] - Xóa thẻ

*Lệnh quản trị:*
/ad [username] - Thêm quản trị viên
/removead [username] - Xóa quản trị viên
/admins - Xem danh sách quản trị viên
/op [username] - Thêm người điều hành
/removeop [username] - Xóa người điều hành
/ops - Xem danh sách người điều hành

*Lệnh khác:*
/u - Xem địa chỉ USDT
/users - Xem danh sách người dùng
/report - Xem báo cáo
`;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in handleHelpCommand:', error);
    bot.sendMessage(chatId, messages.errorDisplayHelp);
  }
};

const handleStartCommand = async (bot, chatId) => {
  try {
    const startMessage = `Chào mừng sử dụng bot kế toán!

Bắt đầu hóa đơn mới / 上课
Ghi nợ▫️+10000 hoặc +số [mã thẻ] [hạn mức]
Thanh toán▫️-10000
Hủy▫️撤回id
Phát hành▫️下发 100 hoặc %số [mã thẻ] [hạn mức]
Thiết lập tỷ lệ▫️设置汇率1600 hoặc | giá tỷ lệ/tỷ giá
Thiết lập người điều hành▫️@thành viên (thành viên phải gửi tin nhắn trước khi thiết lập)
Xóa người điều hành▫️@thành viên (thành viên phải gửi tin nhắn trước khi xóa)
Danh sách người điều hành ▫️ xem danh sách người được ủy quyền

+0▫️
Kết thúc| /report`;
    bot.sendMessage(chatId, startMessage);
  } catch (error) {
    console.error('Error in handleStartCommand:', error);
    bot.sendMessage(chatId, messages.errorProcessingMessage);
  }
};

module.exports = {
  handleCalculateUsdtCommand,
  handleCalculateVndCommand,
  handleMathExpression,
  handleTrc20Address,
  handleReportCommand,
  handleHelpCommand,
  handleStartCommand
}; 