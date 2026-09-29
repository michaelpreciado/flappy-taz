// Performance Optimizer for Flattenhund
// Handles loading optimizations, memory management, and performance monitoring

class PerformanceOptimizer {
    constructor() {
        this.performanceEntries = [];
        this.isLowEndDevice = this.detectLowEndDevice();
        this.connectionType = this.detectConnectionType();
        this.init();
    }
    
    init() {
        this.optimizeForDevice();
        this.setupPerformanceMonitoring();
        this.preloadCriticalAssets();
        
        // Listen for game loaded event
        window.addEventListener('gameAssetsLoaded', () => {
            this.reportLoadingPerformance();
        });
    }
    
    detectLowEndDevice() {
        // Detect if device might be low-end based on available info
        const memory = navigator.deviceMemory || 4; // Default to 4GB if unknown
        const cores = navigator.hardwareConcurrency || 4;
        const connection = navigator.connection;
        
        const isLowEnd = 
            memory < 4 || 
            cores < 4 || 
            (connection && (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'));
            
        if (isLowEnd) {
            console.log('🔧 Low-end device detected - applying optimizations');
        }
        
        return isLowEnd;
    }
    
    detectConnectionType() {
        if (navigator.connection) {
            const type = navigator.connection.effectiveType;
            console.log(`📶 Connection type: ${type}`);
            return type;
        }
        return 'unknown';
    }
    
    optimizeForDevice() {
        // Apply device-specific optimizations
        if (this.isLowEndDevice) {
            // Reduce canvas resolution for low-end devices
            document.documentElement.style.setProperty('--canvas-scale', '0.8');
            
            // Disable some visual effects
            document.documentElement.classList.add('low-end-device');
            
            // Reduce particle count and effects
            window.PERFORMANCE_MODE = 'low';
        } else {
            window.PERFORMANCE_MODE = 'high';
        }
        
        // Optimize for slow connections
        if (this.connectionType === 'slow-2g' || this.connectionType === '2g') {
            // Prioritize critical assets only
            window.LOADING_STRATEGY = 'minimal';
        } else {
            window.LOADING_STRATEGY = 'full';
        }
    }
    
    setupPerformanceMonitoring() {
        // Monitor FPS and performance
        let lastTime = performance.now();
        let frameCount = 0;
        let fps = 0;
        
        const measureFPS = (currentTime) => {
            frameCount++;
            if (currentTime - lastTime >= 1000) {
                fps = Math.round(frameCount * 1000 / (currentTime - lastTime));
                frameCount = 0;
                lastTime = currentTime;
                
                // Adjust quality based on FPS
                if (fps < 30 && window.PERFORMANCE_MODE !== 'low') {
                    console.log('⚡ Low FPS detected - reducing quality');
                    this.reduceQuality();
                }
            }
            requestAnimationFrame(measureFPS);
        };
        
        requestAnimationFrame(measureFPS);
    }
    
    reduceQuality() {
        // Dynamically reduce quality if performance is poor
        document.documentElement.classList.add('reduced-quality');
        window.PERFORMANCE_MODE = 'reduced';
        
        // Disable non-essential effects
        const effects = document.querySelectorAll('.crt-overlay, .background-effects');
        effects.forEach(effect => effect.style.display = 'none');
    }
    
    preloadCriticalAssets() {
        // Intelligent asset preloading based on device capabilities
        const criticalImages = [
            'assets/images/taz.png',
            'assets/images/chloe.png'
        ];
        
        const gameImages = [
        ];
        
        // Always preload critical images
        this.preloadImages(criticalImages, 'critical');
        
        // Preload game images based on connection
        if (this.connectionType !== 'slow-2g' && this.connectionType !== '2g') {
            setTimeout(() => {
                this.preloadImages(gameImages, 'secondary');
            }, 100); // Small delay to prioritize critical assets
        }
    }
    
    preloadImages(imageUrls, priority = 'normal') {
        const startTime = performance.now();
        
        return Promise.all(
            imageUrls.map(url => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const loadTime = performance.now() - startTime;
                        console.log(`✅ Preloaded ${priority}: ${url} (${loadTime.toFixed(1)}ms)`);
                        resolve(img);
                    };
                    img.onerror = () => {
                        console.warn(`❌ Failed to preload: ${url}`);
                        resolve(null);
                    };
                    img.src = url;
                });
            })
        );
    }
    
    reportLoadingPerformance() {
        // Report loading performance metrics
        if (performance.getEntriesByType) {
            const navigation = performance.getEntriesByType('navigation')[0];
            if (navigation) {
                const loadTime = navigation.loadEventEnd - navigation.navigationStart;
                const domContentLoaded = navigation.domContentLoadedEventEnd - navigation.navigationStart;
                
                console.log(`📊 Performance Report:`);
                console.log(`   Total Load Time: ${loadTime.toFixed(1)}ms`);
                console.log(`   DOM Content Loaded: ${domContentLoaded.toFixed(1)}ms`);
                console.log(`   Device Type: ${this.isLowEndDevice ? 'Low-end' : 'Standard'}`);
                console.log(`   Connection: ${this.connectionType}`);
                
                // Send to analytics if available
                if (window.gtag) {
                    window.gtag('event', 'page_load_time', {
                        event_category: 'Performance',
                        value: Math.round(loadTime)
                    });
                }
            }
        }
    }
    
    // Utility method to lazy load non-critical assets
    lazyLoadAsset(src, type = 'script') {
        return new Promise((resolve, reject) => {
            let element;
            
            if (type === 'script') {
                element = document.createElement('script');
                element.src = src;
            } else if (type === 'style') {
                element = document.createElement('link');
                element.rel = 'stylesheet';
                element.href = src;
            }
            
            element.onload = resolve;
            element.onerror = reject;
            
            document.head.appendChild(element);
        });
    }
    
    // Memory cleanup utility
    cleanupUnusedAssets() {
        // Clean up unused images and resources
        const images = document.querySelectorAll('img[data-loaded="true"]');
        images.forEach(img => {
            if (!img.parentNode || img.offsetParent === null) {
                img.src = '';
                img.remove();
            }
        });
    }
}

// Initialize performance optimizer
window.performanceOptimizer = new PerformanceOptimizer();

// Export for use in other scripts
window.PerformanceOptimizer = PerformanceOptimizer; 