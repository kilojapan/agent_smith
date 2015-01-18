if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	AgentSmith = require('./agent_smith');
}

if (typeof AgentSmith === 'undefined' || typeof AgentSmith.Matrix === 'undefined') {
	throw new Error('AgentSmith.Matrix is not loaded');
}

(function() {
	if (typeof AgentSmith.Matrix.CL !== 'undefined') {
		return;
	}

	// check environment
	if (typeof window === 'undefined') {
		var env = 'node';
	} else if (typeof window !== 'undefined' && window.webcl !== void 0) {
		var env = 'ff';
	} else if (typeof WebCL === 'function') {
		var env = 'chromium';
	} else {
		var env = void 0;
	}
	
	// create WebCL object
	switch (env) {
		case 'node':
			var node_webcl_root = '../../../../../node_modules/node-webcl'; // depends on the environment
			try {
				WebCL = require(node_webcl_root + '/webcl');
			} catch (e) {
				WebCL = void 0;
			}
			break;
		case 'chromium':
			WebCL = new WebCL();
			break;
		case 'ff':
			WebCL = window.webcl;
			break;
	}
	
	if (typeof WebCL === 'undefined') {
		console.error('WebCL is not supported in this environment');
		return;
	}

	var $M = AgentSmith.Matrix;
	$M.CL = { buffers : 0 };
	var $CL = $M.CL;
	var $P = $M.prototype;
	
	// Prepare WebCL and functions
	(function () {
		// decide platform to use
		var platform_list = WebCL.getPlatforms();
		var platform_priority = ['CUDA', 'Apple', 'OpenCL'];
		var priority = platform_priority.length + 1;
		var includeIndexOf = function(array, search) {
			for (var i = 0; i < array.length; i++) {
				if (search.indexOf(array[i]) !== -1) {
					return i;
				}
			}
			return array.length;
		};
		for (var i = 0; i < platform_list.length; i++) {
			var platform_tmp = platform_list[i];
			var platform_info_tmp = platform_tmp.getInfo(WebCL.PLATFORM_NAME);
			var priority_tmp = includeIndexOf(platform_priority, platform_info_tmp);
			if (priority_tmp < priority) {
				priority = priority_tmp;
				$CL.platform = platform_tmp;
				$CL.platform_info = platform_info_tmp;
			}
		}
		var device_type = WebCL.DEVICE_TYPE_GPU;
		$CL.devices = $CL.platform.getDevices(WebCL.DEVICE_TYPE_GPU);
		if ($CL.devices.length === 0) {
			device_type = WebCL.DEVICE_TYPE_CPU;
			$CL.devices = $CL.platform.getDevices(WebCL.DEVICE_TYPE_CPU);
		}
		$CL.device_info = $CL.devices[0].getInfo(WebCL.DEVICE_NAME);

		// initialize methods dependent on implementation
		switch(env) {
			case 'node':
				$CL.context = WebCL.createContext({
					deviceType : device_type,
					platform : $CL.platform
				});
				$CL.kernelSetArg = function(kernel, idx, param, type) {
					kernel.setArg(idx, param, type);
				};
				break;
			case 'ff':
				$CL.context = WebCL.createContext($CL.platform, device_type);
				$CL.kernelSetArg = function(kernel, idx, param, type) {
					if (type !== void 0) {
						switch (type) {
							case WebCL.type.UINT:
								param = new Uint32Array([param]);
								break;
							case WebCL.type.INT:
								param = new Int32Array([param]);
								break;
							case WebCL.type.FLOAT:
								param = new Float32Array([param]);
								break;
						}
					}
					kernel.setArg(idx, param);
				};
				break;
			case 'chromium':
					var properties = new WebCLContextProperties();
					properties.platform = $CL.platform;
					properties.deviceType = device_type;
					properties.devices = $CL.devices;
					properties.shareGroup = 1;
					$CL.context = WebCL.createContext(properties);
					$CL.kernelSetArg = function(kernel, idx, param, type) {
					if (type !== void 0) {
						switch (type) {
							case WebCL.type.UINT:
								var type_tmp = WebCL.KERNEL_ARG_UINT;
								break;
							case WebCL.type.INT:
								var type_tmp = WebCL.KERNEL_ARG_INT;
								break;
							case WebCL.type.FLOAT:
								var type_tmp = WebCL.KERNEL_ARG_FLOAT;
								break;
						}
						kernel.setKernelArg(idx, param, type_tmp);
					} else {
						kernel.setKernelArgGlobal(idx, param);
					}
				};
				break;
		}
		switch(env) {
			case 'ff':
			case 'chromium':
				WebCL.type = {
					CHAR: 0,
					UCHAR: 1,
					SHORT: 2,
					USHORT: 3,
					INT: 4,
					UINT: 5,
					LONG: 6,
					ULONG: 7,
					FLOAT: 8,
					HALF: 9,
					DOUBLE: 10,
					QUAD: 11,
					LONG_LONG: 12,
					VEC2: 65536,
					VEC3: 131072,
					VEC4: 262144,
					VEC8: 524288,
					VEC16: 1048576,
					LOCAL_MEMORY_SIZE: 255
				};
				break;
		}
		switch(env) {
			case 'node':
			case 'ff':
				var queue = $CL.context.createCommandQueue($CL.devices[0], 0);
				break;
			case 'chromium':
				var queue = $CL.context.createCommandQueue($CL.devices, null);
				break;
		}
		
		$P.syncData = function() {
			// there being buffer means data is obsolete
			if (this.data === null) {
				this.data = new this.datum_type(this.length);
			}
			if (this.buffer) {
				// console.trace("Write Back!! This may cause the slower calculation.");
				queue.finish();
				queue.enqueueReadBuffer(this.buffer, true, 0, this.byte_length, this.data);
				$CL.releaseBuffer(this.buffer);
				$CL.buffers--;
				this.buffer = null;
			}
		};
		
		switch(env) {
			case 'node':
			case 'ff':
				$CL.releaseBuffer = function(buffer) {
					buffer.release();
				};
				break;
			case 'chromium':
				$CL.releaseBuffer = function(buffer) {
					buffer.releaseCL();
				};
				break;
		}
		
		$P.destruct = function() {
			this.data = void 0;
			if (this.buffer) {
				queue.finish();
				$CL.releaseBuffer(this.buffer);
				$CL.buffers--;
				this.buffer = void 0;
			}
		};
		
		$CL.createKernel = function(code) {
			var program = $CL.context.createProgram(code);
			switch(env) {
				case 'node':
				case 'ff':
					program.build($CL.devices);
					break;
				case 'chromium':
					program.buildProgram(null, null, null);
					break;
			}
			return program.createKernel('kernel_func');
		};
		
		$CL.executeKernel = function() {
			var localWS = [64];
			
			return function(kernel, params, parallelization) {
				for (var i = 0; i < params.length; i++) {
					if (params[i].type === void 0) {
						// matrix
						if (!params[i].datum.buffer) {
							params[i].datum.buffer = $CL.context.createBuffer(WebCL.MEM_READ_WRITE, params[i].datum.byte_length);
							$CL.buffers++;
							if (params[i].access !== WebCL.MEM_WRITE_ONLY) {
								if (params[i].datum.data) {
									queue.enqueueWriteBuffer(params[i].datum.buffer, env === "chromium", 0, params[i].datum.byte_length, params[i].datum.data); // second parameter might have to be true for chromium
								}
							}
						}
						$CL.kernelSetArg(kernel, i, params[i].datum.buffer);
					} else {
						// native type
						$CL.kernelSetArg(kernel, i, params[i].datum, params[i].type);
					}
				};

				var globalWS = [Math.ceil(parallelization / localWS) * localWS];
				// Execute kernel
				switch(env) {
					case 'node':
						queue.enqueueNDRangeKernel(kernel, null, globalWS, localWS);
						break;
					case 'ff':
						queue.enqueueNDRangeKernel(kernel, globalWS.length, null, globalWS, localWS);
						break;
					case 'chromium':
						globalWS = new Int32Array(globalWS);
						queue.enqueueNDRangeKernel(kernel, null, globalWS, null);
						queue.finish();
						break;
				}
				queue.flush();
			};
		}();
		
		$CL.flush = function() {
			queue.flush();
		}
		
		$CL.finish = function() {
			queue.finish();
		}
	})();

	$CL.eachOperationPGenerator = function(operator) {
		var createEachOperationPGeneratorKernel = function(a_i_to_idx, b_i_to_idx) {
			return $CL.createKernel([
				"#define OPERATOR " + operator + "                                                                         ",
				"#define A_I_TO_IDX(i) (" + a_i_to_idx + ")                                                                ",
				"#define B_I_TO_IDX(i) (" + b_i_to_idx + ")                                                                ",
				"__kernel void kernel_func(__global float *a, __global float *b, uint iNumElements, uint rows, uint cols)  ",
				"{                                                                                                         ",
				"    size_t i =  get_global_id(0);                                                                         ",
				"    if(i >= iNumElements) return;                                                                         ",
				"    a[A_I_TO_IDX(i)] = a[A_I_TO_IDX(i)] OPERATOR b[B_I_TO_IDX(i)];                                        ",
				"}                                                                                                         "].join('\r\n')
			);
		};
		// (row-wiss - row-wise) or (col-wise - col-wise)
		var kernel1 = createEachOperationPGeneratorKernel('(i)', '(i)');
		// row-wise - col-wise
		var kernel2 = createEachOperationPGeneratorKernel('(i)', '((i) % cols) * rows + (i) / cols');
		// col-wise - row-wise
		var kernel3 = createEachOperationPGeneratorKernel('((i) % cols) * rows + (i) / cols', '(i)');
		
		// broadcast 1
		var kernel4 = $CL.createKernel([
			"#define OPERATOR " + operator + "                                                                 ",
			"__kernel void kernel_func(__global float *a, __global float *b, uint iNumElements, uint b_length) ",
			"{                                                                                                 ",
			"    size_t i =  get_global_id(0);                                                                 ",
			"    if(i >= iNumElements) return;                                                                 ",
			"    a[i] = a[i] OPERATOR b[i % b_length];                                                 ",
			"}                                                                                                 "].join('\r\n')
		);
		
		// broadcast 2
		var kernel5 = $CL.createKernel([
			"#define OPERATOR " + operator + "                                                               ",
			"__kernel void kernel_func(__global float *a, __global float *b, uint iNumElements, uint b_skip) ",
			"{                                                                                               ",
			"    size_t i =  get_global_id(0);                                                               ",
			"    if(i >= iNumElements) return;                                                               ",
			"    a[i] = a[i] OPERATOR b[i / b_skip];                                                 ",
			"}                                                                                               "].join('\r\n')
		);
		
		return function(mat1, mat2) {
			if (!(
				(mat1.rows === mat2.rows && mat1.cols === mat2.cols) ||
				(mat1.rows === mat2.rows && mat2.cols === 1) ||
				(mat1.cols === mat2.cols && mat2.rows === 1) ) ) {
					throw new Error('shape does not match');
			}
			var kernel_to_use = null;
			if (mat1.rows === mat2.rows && mat1.cols === mat2.cols) {
				if (mat1.row_wise === mat2.row_wise) {
					kernel_to_use = kernel1;
				} else if (mat1.row_wise === true) {
					kernel_to_use = kernel2;
				} else {
					kernel_to_use = kernel3;
				}
			} else if ((mat1.row_wise && mat1.cols === mat2.cols) || (!mat1.row_wise && mat1.rows === mat2.rows)) {
				// broadcast 1
				kernel_to_use = kernel4;
			} else {
				// broadcast 2
				kernel_to_use = kernel5;
			}
			
			var params = [
				{ access : WebCL.MEM_READ_WRITE, datum : mat1 },
				{ access : WebCL.MEM_READ_ONLY, datum : mat2 },
				{ datum : mat1.length, type : WebCL.type.UINT }
			];
			if (kernel_to_use === kernel1 || kernel_to_use === kernel2 || kernel_to_use === kernel3) {
				params.push({ datum : mat1.rows, type : WebCL.type.UINT });
				params.push({ datum : mat1.cols, type : WebCL.type.UINT });
			} else if (kernel_to_use === kernel4) {
				params.push({ datum : mat2.length, type : WebCL.type.UINT });
			} else if (kernel_to_use === kernel5) {
				params.push({ datum : mat1.length / mat2.length, type : WebCL.type.UINT });
			}
			
			$CL.executeKernel(kernel_to_use, params, mat1.length);
		};
	};
	
	$CL.eachOperationMGenerator = function(operator) {
		var createEachOperationMGeneratorKernel = function(a_i_to_idx, b_i_to_idx) {
			return $CL.createKernel([
				"#define OPERATOR " + operator + "                                                                         ",
				"#define A_I_TO_IDX(i) (" + a_i_to_idx + ")                                                                ",
				"#define B_I_TO_IDX(i) (" + b_i_to_idx + ")                                                                ",
				"__kernel void kernel_func(__global float *output, __global float *a, __global float *b, uint iNumElements, uint rows, uint cols)  ",
				"{                                                                                                         ",
				"    size_t i =  get_global_id(0);                                                                         ",
				"    if(i >= iNumElements) return;                                                                         ",
				"    output[i] = a[A_I_TO_IDX(i)] OPERATOR b[B_I_TO_IDX(i)];                                               ",
				"}                                                                                                         "].join('\r\n')
			);
		};
		
		var createEachOperationMGeneratorBroadcastKernel1 = function(a_b_i_to_idx) {
			return $CL.createKernel([
				"#define OPERATOR " + operator + "                                                                 ",
				"#define A_B_I_TO_IDX(i) (" + a_b_i_to_idx + ")                                                    ",
				"__kernel void kernel_func(__global float *output, __global float *a, __global float *b, uint iNumElements, uint rows, uint cols, uint b_length) ",
				"{                                                                                                 ",
				"    size_t i =  get_global_id(0);                                                                 ",
				"    if(i >= iNumElements) return;                                                                 ",
				"    output[i] = a[A_B_I_TO_IDX(i)] OPERATOR b[A_B_I_TO_IDX(i) % b_length];                        ",
				"}                                                                                                 "].join('\r\n')
			);
		};
		
		var createEachOperationMGeneratorBroadcastKernel2 = function(a_b_i_to_idx) {
			return $CL.createKernel([
				"#define OPERATOR " + operator + "                                                                 ",
				"#define A_B_I_TO_IDX(i) (" + a_b_i_to_idx + ")                                                    ",
				"__kernel void kernel_func(__global float *output, __global float *a, __global float *b, uint iNumElements, uint rows, uint cols, uint b_skip) ",
				"{                                                                                                 ",
				"    size_t i =  get_global_id(0);                                                                 ",
				"    if(i >= iNumElements) return;                                                                 ",
				"    output[i] = a[A_B_I_TO_IDX(i)] OPERATOR b[A_B_I_TO_IDX(i) / b_skip];                           ",
				"}                                                                                                 "].join('\r\n')
			);
		};
		
		// row-wiss - row-wise
		var kernel1 = createEachOperationMGeneratorKernel('(i)', '(i)');
		// row-wise - col-wise
		var kernel2 = createEachOperationMGeneratorKernel('(i)', '((i) % cols) * rows + (i) / cols');
		// col-wise - row-wise
		var kernel3 = createEachOperationMGeneratorKernel('((i) % cols) * rows + (i) / cols', '(i)');
		// col-wise - col-wise
		var kernel4 = createEachOperationMGeneratorKernel('((i) % cols) * rows + (i) / cols', '((i) % cols) * rows + (i) / cols');
		
		// broadcast 1
		var kernel5 = createEachOperationMGeneratorBroadcastKernel1('(i)');
		var kernel6 = createEachOperationMGeneratorBroadcastKernel1('((i) % cols) * rows + (i) / cols');
		
		// broadcast 2
		var kernel7 = createEachOperationMGeneratorBroadcastKernel2('(i)');
		var kernel8 = createEachOperationMGeneratorBroadcastKernel2('((i) % cols) * rows + (i) / cols');
		
		return function(mat1, mat2, output) {
			if (!(
				(mat1.rows === mat2.rows && mat1.cols === mat2.cols) ||
				(mat1.rows === mat2.rows && mat2.cols === 1) ||
				(mat1.cols === mat2.cols && mat2.rows === 1) ) ) {
					throw new Error('shape does not match');
			}
			var newM = $M.newMatOrReuseMat(mat1.rows, mat1.cols, output);
			var kernel_to_use = null;
			if (mat1.rows === mat2.rows && mat1.cols === mat2.cols) {
				if (mat1.row_wise && mat2.row_wise) {
					kernel_to_use = kernel1;
				} else if (mat1.row_wise && !mat2.row_wise) {
					kernel_to_use = kernel2;
				} else if (!mat1.row_wise && mat2.row_wise) {
					kernel_to_use = kernel3;
				} else {
					kernel_to_use = kernel4;
				}
			} else if ((mat1.row_wise && mat1.cols === mat2.cols) || (!mat1.row_wise && mat1.rows === mat2.rows)) {
				// broadcast 1
				kernel_to_use = mat1.row_wise ? kernel5 : kernel6;
			} else {
				// broadcast 2
				kernel_to_use = mat1.row_wise ? kernel7 : kernel8;
			}
			
			var params = [
				{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
				{ access : WebCL.MEM_READ_WRITE, datum : mat1 },
				{ access : WebCL.MEM_READ_ONLY, datum : mat2 },
				{ datum : mat1.length, type : WebCL.type.UINT },
				{ datum : mat1.rows, type : WebCL.type.UINT },
				{ datum : mat1.cols, type : WebCL.type.UINT }
			];
				
			if (kernel_to_use === kernel5 || kernel_to_use === kernel6) {
				params.push({ datum : mat2.length, type : WebCL.type.UINT });
			} else if (kernel_to_use === kernel7 || kernel_to_use === kernel8) {
				params.push({ datum : mat1.length / mat2.length, type : WebCL.type.UINT });
			}
			
			$CL.executeKernel(kernel_to_use, params, mat1.length);
			
			return newM;
		};
	};
	
	$CL.mapGenerator = function(expression_ai) {
		// if the wises are same
		var kernel = $CL.createKernel([
			"__kernel void kernel_func(__global float *a, uint iNumElements) ",
			"{                                                                           ",
			"    size_t i =  get_global_id(0);                                           ",
			"    if(i >= iNumElements) return;                                           ",
			"    a[i] = " + expression_ai + ";                                            ",
			"}                                                                           "].join('\r\n')
		);
		
		return function(mat) {
			var params = [
				{ access : WebCL.MEM_READ_WRITE, datum : mat },
				{ datum : mat.length, type : WebCL.type.UINT }
			];
			$CL.executeKernel(kernel, params, mat.length);
		};
	};
	
	$CL.addP = $CL.eachOperationPGenerator('+');
	
	$CL.subP = $CL.eachOperationPGenerator('-');
	
	$CL.mulEachP = $CL.eachOperationPGenerator('*');
	
	$CL.divEachP = $CL.eachOperationPGenerator('/');
	
	$CL.addM = $CL.eachOperationMGenerator('+');
	
	$CL.subM = $CL.eachOperationMGenerator('-');
	
	$CL.mulEachM = $CL.eachOperationMGenerator('*');
	
	$CL.divEachM = $CL.eachOperationMGenerator('/');
	
	$CL.mul = function() {
		var createMulKernel = function(a_row_col_to_idx, b_row_col_to_idx) {
			return $CL.createKernel([
				"#define A_ROW_COL_TO_IDX(row, col) (" + a_row_col_to_idx + ")               ",
				"#define B_ROW_COL_TO_IDX(row, col) (" + b_row_col_to_idx + ")               ",
 				"__kernel void kernel_func(__global float *a, __global float *b, __global float *c, uint iNumElements, uint rows, uint cols, uint width) ",
				"{                                                                           ",
				"    size_t i =  get_global_id(0);                                           ",
				"    if(i >= iNumElements) return;                                           ",
				"    uint row = i / cols;                                                    ",
				"    uint col = i % cols;                                                    ",
				"    c[i] = 0.0;                                                             ",
				"    for (uint j = 0; j < width; j++) {                                      ",
				"        c[i] += a[A_ROW_COL_TO_IDX(row, j)] * b[B_ROW_COL_TO_IDX(j, col)];  ",
				"    }                                                                       ",
				"}                                                                           "].join('\r\n')
			);
		};
		var kernel1 = createMulKernel('(row) * width + (col)', '(row) * cols + (col)');
		var kernel2 = createMulKernel('(row) * width + (col)', '(row) + (col) * width');
		var kernel3 = createMulKernel('(row) + (col) * rows', '(row) * cols + (col)');
		var kernel4 = createMulKernel('(row) + (col) * rows', '(row) + (col) * width');

		return function(mat1, mat2, output) {
			if (mat1.cols !== mat2.rows) {
				throw new Error('shape does not match');
			}
			if (mat1.row_wise === true && mat2.row_wise === true) {
				kernel_to_use = kernel1;
			} else if (mat1.row_wise === true && mat2.row_wise === false) {
				kernel_to_use = kernel2;
			} else if (mat1.row_wise === false && mat2.row_wise === true) {
				kernel_to_use = kernel3;
			} else {
				kernel_to_use = kernel4;
			}
			
			var newM = $M.newMatOrReuseMat(mat1.rows, mat2.cols, output);
			$CL.executeKernel(
				kernel_to_use,
				[
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ access : WebCL.MEM_READ_ONLY, datum : mat2 },
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ datum : newM.length, type : WebCL.type.UINT},
					{ datum : newM.rows, type : WebCL.type.UINT},
					{ datum : newM.cols, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.convolve = function() {
		var createConvolveKernel = function(mat1_row_col_to_idx, mat2_row_col_to_idx) {
			return $CL.createKernel([
					"#define MAT1_ROW_COL_TO_IDX(row, col) (" + mat1_row_col_to_idx + ")            ",
					"#define MAT2_ROW_COL_TO_IDX(row, col) (" + mat2_row_col_to_idx + ")            ",
					"__kernel void kernel_func(__global float *mat1, __global float *mat2, __global float *output, uint cols, uint mat1_rows, uint mat1_cols, uint mat2_rows, uint mat2_cols, uint offset_row, uint offset_col, uint iNumElements) ",
					"{                                                                              ",
					"    size_t i =  get_global_id(0);                                              ",
					"    if(i >= iNumElements) return;                                              ",
					"    uint row = i / cols;                                                       ",
					"    uint col = i % cols;                                                       ",
					"    int tmp_row;                                                               ",
					"    int tmp_col;                                                               ",
					"    output[i] = 0.0;                                                           ",
					"    for (uint d_row = 0; d_row < mat2_rows; d_row++) {                         ",
					"        for (uint d_col = 0; d_col < mat2_cols; d_col++) {                     ",
					"            tmp_row = row + d_row - offset_row;                                ",
					"            tmp_col = col + d_col - offset_col;                                ",
					"            if (tmp_row < 0 || tmp_row >= mat1_rows ||                         ",
					"                tmp_col < 0 || tmp_col >= mat1_cols ) {                        ",
					"                continue;                                                      ",
					"            }                                                                  ",
					"            output[i] += mat1[MAT1_ROW_COL_TO_IDX(tmp_row, tmp_col)] *         ",
					"                    mat2[MAT2_ROW_COL_TO_IDX(d_row, d_col)];                   ",
					"        }                                                                      ",
					"    }                                                                          ",
					"}                                                                              "].join('\r\n')
				);
		};
		var kernel1 = createConvolveKernel('mat1_cols * (row) + (col)', 'mat2_cols * (row) + (col)');
		var kernel2 = createConvolveKernel('mat1_cols * (row) + (col)', 'mat2_rows * (col) + (row)');
		var kernel3 = createConvolveKernel('mat1_rows * (col) + (row)', 'mat2_cols * (row) + (col)');
		var kernel4 = createConvolveKernel('mat1_rows * (col) + (row)', 'mat2_rows * (col) + (row)');

		return function(mat1, mat2, mode, output) {
			if (mode === 'valid' && (mat1.cols < mat2.cols || mat1.rows < mat2.rows)) {
				throw new Error('the size of the second matrix must be smaller than that of the first one');
			}
			if (mat1.row_wise === true && mat2.row_wise === true) {
				kernel_to_use = kernel1;
			} else if (mat1.row_wise === true && mat2.row_wise === false) {
				kernel_to_use = kernel2;
			} else if (mat1.row_wise === false && mat2.row_wise === true) {
				kernel_to_use = kernel3;
			} else {
				kernel_to_use = kernel4;
			}
			
			if (mode === 'valid') {
				var newM = $M.newMatOrReuseMat(mat1.rows - mat2.rows + 1, mat1.cols - mat2.cols + 1, output);
				var offset_row = 0;
				var offset_col = 0;
			} else if (mode === 'full') {
				var newM = $M.newMatOrReuseMat(mat1.rows + mat2.rows - 1, mat1.cols + mat2.cols - 1, output);
				var offset_row = mat2.rows - 1;
				var offset_col = mat2.cols - 1;
			} else if (mode === 'same') {
				var newM = $M.newMatOrReuseMat(mat1.rows, mat1.cols, output);
				var offset_row = Math.floor((mat2.rows - 1) / 2);
				var offset_col = Math.floor((mat2.cols - 1) / 2);
			} else {
				throw new Error('the mode is not supported');
			}
			$CL.executeKernel(
				kernel_to_use,
				[
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ access : WebCL.MEM_READ_ONLY, datum : mat2 },
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ datum : newM.cols, type : WebCL.type.UINT},
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : mat2.rows, type : WebCL.type.UINT},
					{ datum : mat2.cols, type : WebCL.type.UINT},
					{ datum : offset_row, type : WebCL.type.UINT},
					{ datum : offset_col, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT}
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.times = function() {
		var kernel_to_use = $CL.createKernel([
				"__kernel void kernel_func(__global float *a, float b, uint iNumElements)    ",
				"{                                                                           ",
				"    size_t i =  get_global_id(0);                                           ",
				"    if(i >= iNumElements) return;                                           ",
				"    a[i] *= b;                                                              ",
				"}                                                                           "].join('\r\n')
			);
		return function(mat1, times) {
			$CL.executeKernel(
				kernel_to_use,
				[
					{ access : WebCL.MEM_READ_WRITE, datum : mat1 },
					{ datum : times, type : WebCL.type.FLOAT}, 
					{ datum : mat1.length, type : WebCL.type.UINT }
				],
				mat1.length
			);
			return mat1;
		};
	}();
	
	$CL.zeros = function() {
		var kernel_to_use = $CL.createKernel([
				"__kernel void kernel_func(__global float *a, float b, uint iNumElements)    ",
				"{                                                                           ",
				"    size_t i =  get_global_id(0);                                           ",
				"    if(i >= iNumElements) return;                                           ",
				"    a[i] = b;                                                               ",
				"}                                                                           "].join('\r\n')
			);
		return function(mat1, num) {
			if (!num) { var num = 0; }
			$CL.executeKernel(
				kernel_to_use,
				[
					{ access : WebCL.MEM_READ_WRITE, datum : mat1 },
					{ datum : num, type : WebCL.type.FLOAT}, 
					{ datum : mat1.length, type : WebCL.type.UINT }
				],
				mat1.length
			);
			return mat1;
		};
	}();
	
	$CL.sumEachRow = function() {
		var createSumEachRowKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")                                                 ",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements) ",
  				"{                                                                                                        ",
  				"    size_t i =  get_global_id(0);                                                                        ",
  				"    if(i >= iNumElements) return;                                                                        ",
  				"    a[i] = 0;                                                                                            ",
  				"    for (uint j = 0; j < cols; j++) {                                                                    ",
  				"        a[i] += b[ROW_COL_TO_IDX(i, j)];                                                                 ",
  				"    }                                                                                                    ",
  				"}                                                                                                        "].join('\r\n')
  			);
		};
		var kernel1 = createSumEachRowKernel('(row) * cols + (col)');
		var kernel2 = createSumEachRowKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(mat1.rows, 1, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.sumEachCol = function() {
		var createSumEachColKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")                                                 ",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements) ",
  				"{                                                                                                        ",
  				"    size_t i =  get_global_id(0);                                                                        ",
  				"    if(i >= iNumElements) return;                                                                        ",
  				"    a[i] = 0;                                                                                            ",
  				"    for (uint j = 0; j < rows; j++) {                                                                    ",
  				"        a[i] += b[ROW_COL_TO_IDX(j, i)];                                                                 ",
  				"    }                                                                                                    ",
  				"}                                                                                                        "].join('\r\n')
  			);
		};
		var kernel1 = createSumEachColKernel('(row) * cols + (col)');
		var kernel2 = createSumEachColKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(1, mat1.cols, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.maxEachRow = function() {
		var createMaxEachRowKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")                                                 ",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements) ",
  				"{                                                                                                        ",
  				"    size_t i =  get_global_id(0);                                                                        ",
  				"    if(i >= iNumElements) return;                                                                        ",
  				"    a[i] = b[ROW_COL_TO_IDX(i, 0)];                                                                      ",
  				"    for (uint j = 0; j < cols; j++) {                                                                    ",
  				"        a[i] = max(a[i], b[ROW_COL_TO_IDX(i, j)]);                                                       ",
  				"    }                                                                                                    ",
  				"}                                                                                                        "].join('\r\n')
  			);
		};
		var kernel1 = createMaxEachRowKernel('(row) * cols + (col)');
		var kernel2 = createMaxEachRowKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(mat1.rows, 1, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();

	$CL.argmaxEachRow = function() {
		var createArgmaxEachRowKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")													",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements)	",
  				"{																											",
  				"	size_t i =  get_global_id(0);																			",
  				"	if(i >= iNumElements) return;																			",
  				"	float max_val = b[ROW_COL_TO_IDX(i, 0)];															 	",
  				"	a[i] = 0;																								",
  				"	for (uint j = 0; j < cols; j++) {																		",
  				"		float tmp = b[ROW_COL_TO_IDX(i, j)];																",
  				"		if (tmp > max_val) {																				",
  				"			a[i] = j;																						",
  				"			max_val = tmp;																					",
  				"		}																									",
  				"	}																										",
  				"}																											"].join('\r\n')
  			);
		};
		var kernel1 = createArgmaxEachRowKernel('(row) * cols + (col)');
		var kernel2 = createArgmaxEachRowKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(mat1.rows, 1, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.argminEachRow = function() {
		var createArgminEachRowKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")													",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements)	",
  				"{																											",
  				"	size_t i =  get_global_id(0);																			",
  				"	if(i >= iNumElements) return;																			",
  				"	float min_val = b[ROW_COL_TO_IDX(i, 0)];															 	",
  				"	a[i] = 0;																								",
  				"	for (uint j = 0; j < cols; j++) {																		",
  				"		float tmp = b[ROW_COL_TO_IDX(i, j)];																",
  				"		if (tmp < min_val) {																				",
  				"			a[i] = j;																						",
  				"			min_val = tmp;																					",
  				"		}																									",
  				"	}																										",
  				"}																											"].join('\r\n')
  			);
		};
		var kernel1 = createArgminEachRowKernel('(row) * cols + (col)');
		var kernel2 = createArgminEachRowKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(mat1.rows, 1, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.maxEachCol = function() {
		var createMaxEachColKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")                                                 ",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements) ",
  				"{                                                                                                        ",
  				"    size_t i =  get_global_id(0);                                                                        ",
  				"    if(i >= iNumElements) return;                                                                        ",
  				"    a[i] = b[ROW_COL_TO_IDX(0, i)];                                                                      ",
  				"    for (uint j = 0; j < rows; j++) {                                                                    ",
  				"        a[i] = max(a[i], b[ROW_COL_TO_IDX(j, i)]);                                                       ",
  				"    }                                                                                                    ",
  				"}                                                                                                        "].join('\r\n')
  			);
		};
		var kernel1 = createMaxEachColKernel('(row) * cols + (col)');
		var kernel2 = createMaxEachColKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(1, mat1.cols, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$CL.argmaxEachCol = function() {
		var createArgmaxEachColKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")													",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements)	",
  				"{																											",
  				"	size_t i =  get_global_id(0);																			",
  				"	if(i >= iNumElements) return;																			",
  				"	float max_val = b[ROW_COL_TO_IDX(0, i)];																",
  				"	a[i] = 0;																								",
  				"	for (uint j = 0; j < rows; j++) {																		",
  				"		float tmp = b[ROW_COL_TO_IDX(j, i)];																",
  				"		if (tmp > max_val) {																				",
  				"			a[i] = j;																						",
  				"			max_val = tmp;																					",
  				"		}																									",
  				"	}																										",
  				"}																											"].join('\r\n')
  			);
		};
		var kernel1 = createArgmaxEachColKernel('(row) * cols + (col)');
		var kernel2 = createArgmaxEachColKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(1, mat1.cols, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();

	$CL.argminEachCol = function() {
		var createArgminEachColKernel = function(row_col_to_idx) {
			return $CL.createKernel([
				"#define ROW_COL_TO_IDX(row, col) (" + row_col_to_idx +")													",
  				"__kernel void kernel_func(__global float *a, __global float *b, uint rows, uint cols, uint iNumElements)	",
  				"{																											",
  				"	size_t i =  get_global_id(0);																			",
  				"	if(i >= iNumElements) return;																			",
  				"	float min_val = b[ROW_COL_TO_IDX(0, i)];																",
  				"	a[i] = 0;																								",
  				"	for (uint j = 0; j < rows; j++) {																		",
  				"		float tmp = b[ROW_COL_TO_IDX(j, i)];																",
  				"		if (tmp < min_val) {																				",
  				"			a[i] = j;																						",
  				"			min_val = tmp;																					",
  				"		}																									",
  				"	}																										",
  				"}																											"].join('\r\n')
  			);
		};
		var kernel1 = createArgminEachColKernel('(row) * cols + (col)');
		var kernel2 = createArgminEachColKernel('(col) * rows + (row)');
		
		return function(mat1, output) {
			var newM = $M.newMatOrReuseMat(1, mat1.cols, output);
			$CL.executeKernel(
				mat1.row_wise ? kernel1 : kernel2,
				[
					{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
					{ access : WebCL.MEM_READ_ONLY, datum : mat1 },
					{ datum : mat1.rows, type : WebCL.type.UINT},
					{ datum : mat1.cols, type : WebCL.type.UINT},
					{ datum : newM.length, type : WebCL.type.UINT }
				],
				newM.length
			);
			return newM;
		};
	}();
	
	$P.alias = function() {
		var newM = new $M(this.rows, this.cols, null);
		newM.copyPropertyFrom(this);
		newM.data = this.data;
		newM.buffer = this.buffer;
		return newM;
	};
	
	$CL.clone = function() {
		var kernel = $CL.createKernel([
				"__kernel void kernel_func(__global float *a, __global float *b, uint iNumElements)   ",
				"{                                                                           ",
				"    size_t i =  get_global_id(0);                                           ",
				"    if(i >= iNumElements) return;                                           ",
				"    a[i] = b[i];                                                            ",
				"}                                                                           "].join('\r\n')
			);
		return function(mat, output) {
			var newM = $M.newMatOrReuseMat(mat.rows, mat.cols, output);
			newM.copyPropertyFrom(mat);
			$CL.executeKernel(
					kernel,
					[
						{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
						{ access : WebCL.MEM_READ_ONLY, datum : mat },
						{ datum : newM.length, type : WebCL.type.UINT }
					],
					newM.length
				);
			return newM;
		};
	}();
	
	$CL.extract = function() {
		var createExtractKernel = function(input_row_col_to_idx) {
			return $CL.createKernel([
				"#define INPUT_ROW_COL_TO_INDEX(row, col) (" + input_row_col_to_idx + ")",
				"__kernel void kernel_func(__global float *output, __global float *input, uint offset_row, uint offset_col, uint input_rows, uint input_cols, uint cols, uint iNumElements)   ",
				"{                                                                           ",
				"    size_t i =  get_global_id(0);                                           ",
				"    if(i >= iNumElements) return;                                           ",
				"    uint row = offset_row + i / cols;                                       ",
				"    uint col = offset_col + i % cols;                                       ",
				"    output[i] = input[INPUT_ROW_COL_TO_INDEX(row, col)];                    ",
				"}                                                                           "].join('\r\n')
			);
		};
		var kernel1 = createExtractKernel('input_cols * (row) + (col)');
		var kernel2 = createExtractKernel('input_rows * (col) + (row)');
		
		return function(mat, offset_row, offset_col, rows, cols, output) {
			if ((mat.rows < rows + offset_row) || (mat.cols < cols + offset_col)) {
				throw new Error('out of bounds');
			}
			var newM = $M.newMatOrReuseMat(rows, cols, output);
			if (mat.row_wise) {
				var kernel_to_use = kernel1;
			} else {
				var kernel_to_use = kernel2;
			}
			$CL.executeKernel(
					kernel_to_use,
					[
						{ access : WebCL.MEM_WRITE_ONLY, datum : newM },
						{ access : WebCL.MEM_READ_ONLY, datum : mat },
						{ datum : offset_row, type : WebCL.type.UINT },
						{ datum : offset_col, type : WebCL.type.UINT },
						{ datum : mat.rows, type : WebCL.type.UINT },
						{ datum : mat.cols, type : WebCL.type.UINT },
						{ datum : cols, type : WebCL.type.UINT },
						{ datum : newM.length, type : WebCL.type.UINT }
					],
					newM.length
				);
			return newM;
		}
	}();
	
	$CL.writeSubmat = function() {
		var createSubMatKernel = function(mat_row_col_to_idx, submat_row_col_to_idx) {
			return $CL.createKernel([
				"#define MAT_ROW_COL_TO_INDEX(row, col) (" + mat_row_col_to_idx + ")",
				"#define SUBMAT_ROW_COL_TO_INDEX(row, col) (" + submat_row_col_to_idx + ")",
				"__kernel void kernel_func(__global float *mat, __global float *submat, uint offset_row, uint offset_col, uint mat_rows, uint mat_cols, uint submat_rows, uint submat_cols, uint iNumElements)   ",
				"{                                                                              ",
				"    size_t i =  get_global_id(0);                                              ",
				"    if(i >= iNumElements) return;                                              ",
				"    uint row = i / submat_cols;                                                ",
				"    uint col = i % submat_cols;                                                ",
				"    mat[MAT_ROW_COL_TO_INDEX(offset_row + row, offset_col + col)] =            ",
				"        submat[SUBMAT_ROW_COL_TO_INDEX(row, col)];                             ",
				"}                                                                              "].join('\r\n')
			);
		};
		var kernel1 = createSubMatKernel('mat_cols * (row) + (col)', 'submat_cols * (row) + (col)');
		var kernel2 = createSubMatKernel('mat_cols * (row) + (col)', 'submat_rows * (col) + (row)');
		var kernel3 = createSubMatKernel('mat_rows * (col) + (row)', 'submat_cols * (row) + (col)');
		var kernel4 = createSubMatKernel('mat_rows * (col) + (row)', 'submat_rows * (col) + (row)');
		
		return function(mat, submat, offset_row, offset_col) {
			if ((mat.rows < submat.rows + offset_row) || (mat.cols < submat.cols + offset_col)) {
				throw new Error('out of bounds');
			}
			if (mat.row_wise) {
				if (submat.row_wise) {
					var kernel_to_use = kernel1;
				} else {
					var kernel_to_use = kernel2;
				}
			} else {
				if (submat.row_wise) {
					var kernel_to_use = kernel3;
				} else {
					var kernel_to_use = kernel4;
				}
			}
			$CL.executeKernel(
					kernel_to_use,
					[
						{ access : WebCL.MEM_READ_WRITE, datum : mat },
						{ access : WebCL.MEM_READ_ONLY, datum : submat },
						{ datum : offset_row, type : WebCL.type.UINT },
						{ datum : offset_col, type : WebCL.type.UINT },
						{ datum : mat.rows, type : WebCL.type.UINT },
						{ datum : mat.cols, type : WebCL.type.UINT },
						{ datum : submat.rows, type : WebCL.type.UINT },
						{ datum : submat.cols, type : WebCL.type.UINT },
						{ datum : submat.length, type : WebCL.type.UINT }
					],
					submat.length
				);
			return mat;
		}
	}();
	
	// alter large matrix calculation
	(function() {
		$P.largeAdd = function(mat) { $CL.addP(this, mat); return this; };
		$P.largeSub = function(mat) { $CL.subP(this, mat); return this; };
		$P.largeMulEach = function(mat) { $CL.mulEachP(this, mat); return this; };
		$P.largeDivEach = function(mat) { $CL.divEachP(this, mat); return this; };
		$P.largeMul = function(mat, output) { return $CL.mul(this, mat, output); };
		$P.largeTimes = function(times) { return $CL.times(this, times); };
		$P.largeClone = function(output) { return $CL.clone(this, output); };
		$P.largeZeros = function(num) { return $CL.zeros(this, num); };
		
		$M.largeAdd = $CL.addM;
		$M.largeSub = $CL.subM;
		$M.largeMulEach = $CL.mulEachM;
		$M.largeDivEach = $CL.divEachM;
		$M.largeMul = $CL.mul;
		$M.largeSum = function(mat) {
			var row_sum = $CL.sumEachRow(mat);
			var col_sum = $CL.sumEachCol(row_sum);
			var sum = col_sum.get(0, 0);
			row_sum.destruct();
			col_sum.destruct();
			return sum;
		};
		
		$M.largeSumEachRow = $CL.sumEachRow;
		$M.largeSumEachCol = $CL.sumEachCol;
		$M.largeMaxEachRow = $CL.maxEachRow;
		$M.largeMaxEachCol = $CL.maxEachCol;
		$M.largeArgmaxEachRow = $CL.argmaxEachRow;
		$M.largeArgmaxEachCol = $CL.argmaxEachCol;
		$M.largeArgminEachRow = $CL.argminEachRow;
		$M.largeArgminEachCol = $CL.argminEachCol;
		$M.largeConvolve = $CL.convolve;
		$M.largeExtract = $CL.extract;
		$M.largeWriteSubmat = $CL.writeSubmat;
	})();
})();
