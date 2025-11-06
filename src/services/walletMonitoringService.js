/**
 * Wallet Monitoring Service
 * 
 * Автоматически следит за балансом service wallet и пополняет его
 * когда баланс становится слишком низким
 */

require('dotenv').config();

const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getServiceWallet } = require('../config/serviceWallet');
const { PLATFORM_WALLET } = require('../config/platformWallet');

class WalletMonitoringService {
  constructor() {
    this.connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    this.serviceWallet = null;
    this.isMonitoring = false;
    this.checkInterval = null;
    
    // Настройки пополнения
    this.config = {
      minBalance: 5.0,        // Минимальный баланс в SOL
      refillAmount: 20.0,     // Сумма пополнения в SOL
      checkIntervalMs: 60000, // Проверка каждую минуту
      enabled: true           // Включить/выключить автопополнение
    };
  }

  /**
   * Инициализация сервиса
   */
  async initialize() {
    try {
      this.serviceWallet = await getServiceWallet();
      console.log('💰 Wallet Monitoring Service initialized');
      console.log('Service wallet:', this.serviceWallet.publicKey.toString());
      console.log('Platform wallet:', PLATFORM_WALLET.toString());
      console.log('Config:', this.config);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize wallet monitoring:', error);
      return false;
    }
  }

  /**
   * Проверить баланс service wallet
   */
  async checkServiceWalletBalance() {
    try {
      const balance = await this.connection.getBalance(this.serviceWallet.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      
      console.log(`💰 Service wallet balance: ${balanceSOL.toFixed(6)} SOL`);
      
      return {
        balance: balanceSOL,
        needsRefill: balanceSOL < this.config.minBalance
      };
    } catch (error) {
      console.error('❌ Error checking service wallet balance:', error);
      return { balance: 0, needsRefill: false };
    }
  }

  /**
   * Проверить баланс platform wallet
   */
  async checkPlatformWalletBalance() {
    try {
      const balance = await this.connection.getBalance(PLATFORM_WALLET);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      
      console.log(`🏦 Platform wallet balance: ${balanceSOL.toFixed(6)} SOL`);
      
      return {
        balance: balanceSOL,
        canRefill: balanceSOL >= this.config.refillAmount
      };
    } catch (error) {
      console.error('❌ Error checking platform wallet balance:', error);
      return { balance: 0, canRefill: false };
    }
  }

  /**
   * Пополнить service wallet с platform wallet
   */
  async refillServiceWallet() {
    try {
      console.log('🔄 Attempting to refill service wallet...');
      
      // Проверяем балансы
      const serviceStatus = await this.checkServiceWalletBalance();
      const platformStatus = await this.checkPlatformWalletBalance();
      
      if (!serviceStatus.needsRefill) {
        console.log('✅ Service wallet balance is sufficient');
        return { success: true, reason: 'sufficient_balance' };
      }
      
      if (!platformStatus.canRefill) {
        console.log('❌ Platform wallet has insufficient funds for refill');
        console.log(`Need ${this.config.refillAmount} SOL, have ${platformStatus.balance.toFixed(6)} SOL`);
        return { success: false, reason: 'insufficient_platform_funds' };
      }
      
      // ВАЖНО: Для автоматического пополнения нужен приватный ключ platform wallet
      // В текущей реализации platform wallet только получает средства
      // Для пополнения нужно либо:
      // 1. Добавить приватный ключ platform wallet (небезопасно)
      // 2. Использовать multisig
      // 3. Делать пополнение вручную
      
      console.log('⚠️ Automatic refill requires platform wallet private key');
      console.log('💡 For now, please refill manually:');
      console.log(`   Send ${this.config.refillAmount} SOL from platform wallet to service wallet`);
      console.log(`   Platform: ${PLATFORM_WALLET.toString()}`);
      console.log(`   Service: ${this.serviceWallet.publicKey.toString()}`);
      
      return { success: false, reason: 'manual_refill_required' };
      
    } catch (error) {
      console.error('❌ Error refilling service wallet:', error);
      return { success: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Запустить мониторинг
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('⚠️ Monitoring already started');
      return;
    }
    
    if (!this.config.enabled) {
      console.log('⚠️ Wallet monitoring is disabled');
      return;
    }
    
    console.log('🚀 Starting wallet monitoring...');
    this.isMonitoring = true;
    
    // Первая проверка сразу
    this.performCheck();
    
    // Периодические проверки
    this.checkInterval = setInterval(() => {
      this.performCheck();
    }, this.config.checkIntervalMs);
    
    console.log(`✅ Wallet monitoring started (check every ${this.config.checkIntervalMs / 1000}s)`);
  }

  /**
   * Остановить мониторинг
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      console.log('⚠️ Monitoring not running');
      return;
    }
    
    console.log('🛑 Stopping wallet monitoring...');
    this.isMonitoring = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    console.log('✅ Wallet monitoring stopped');
  }

  /**
   * Выполнить проверку и пополнение при необходимости
   */
  async performCheck() {
    try {
      console.log('🔍 Performing wallet balance check...');
      
      const serviceStatus = await this.checkServiceWalletBalance();
      
      if (serviceStatus.needsRefill) {
        console.log('⚠️ Service wallet needs refill!');
        const refillResult = await this.refillServiceWallet();
        
        if (refillResult.success) {
          console.log('✅ Service wallet refilled successfully');
        } else {
          console.log('❌ Failed to refill service wallet:', refillResult.reason);
          
          // Отправить алерт (можно добавить webhook, email, etc.)
          this.sendLowBalanceAlert(serviceStatus.balance);
        }
      } else {
        console.log('✅ Service wallet balance is healthy');
      }
      
    } catch (error) {
      console.error('❌ Error during wallet check:', error);
    }
  }

  /**
   * Отправить алерт о низком балансе
   */
  sendLowBalanceAlert(balance) {
    console.log('🚨 LOW BALANCE ALERT 🚨');
    console.log(`Service wallet balance: ${balance.toFixed(6)} SOL`);
    console.log(`Minimum required: ${this.config.minBalance} SOL`);
    console.log('Action required: Manual refill needed');
    
    // Здесь можно добавить:
    // - Отправку в Discord/Slack
    // - Email уведомления
    // - Push уведомления
    // - Webhook вызовы
  }

  /**
   * Получить статус мониторинга
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      config: this.config,
      serviceWallet: this.serviceWallet?.publicKey.toString(),
      platformWallet: PLATFORM_WALLET.toString()
    };
  }

  /**
   * Обновить конфигурацию
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ Wallet monitoring config updated:', this.config);
  }
}

// Создать singleton instance
const walletMonitoringService = new WalletMonitoringService();

module.exports = walletMonitoringService;
