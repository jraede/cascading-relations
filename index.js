var Q, dot, mongoose, _;

mongoose = require('mongoose');

dot = require('dotaccess');

Q = require('q');

_ = require('underscore');

module.exports = function(schema, options) {
  schema.virtual('_related').get(function() {
    return this.$__.related;
  }).set(function(val) {
    return this.$__.related = val;
  });
  schema.set('toObject', {
    virtuals: true
  });
  schema.set('toJSON', {
    virtuals: true
  });
  schema.post('init', function(next) {
    this.$__movePopulated();
    return true;
  });
  schema.methods.$__movePopulated = function(paths) {
    var info, orig, path, val, _i, _len, _results;
    if (paths == null) {
      paths = null;
    }
    if (this.$__.populated != null) {
      if (this._related == null) {
        this._related = {};
      }
      if (paths) {
        if (!(paths instanceof Array)) {
          paths = [paths];
        }
      } else {
        paths = _.keys(this.$__.populated);
      }
      _results = [];
      for (_i = 0, _len = paths.length; _i < _len; _i++) {
        path = paths[_i];
        info = this.$__.populated[path];
        if (info == null) {
          continue;
        }
        val = info.value;
        orig = dot.get(this, path);
        if (orig instanceof Array) {
          orig.push = Array.prototype.push;
        }
        dot.set(this, path, val, true);
        dot.set(this._related, path, orig, true);
        _results.push(delete this.$__.populated[path]);
      }
      return _results;
    }
  };
  schema.methods.populate = function() {
    var args, callback, paths,
      _this = this;
    args = _.values(arguments);
    paths = args[0];
    callback = args.pop();
    args.push(function(err, doc) {
      if (!err) {
        _this.$__movePopulated(paths);
        return callback(err, doc);
      } else {
        return callback(err, doc);
      }
    });
    return mongoose.Document.prototype.populate.apply(this, args);
  };
  schema.methods.cascadeSave = function(callback, config) {
    if (config == null) {
      config = null;
    }
    this.$__.cascadeSave = true;
    this.$__.cascadeSaveConfig = config;
    return this.save(callback);
  };
  schema.methods.$__saveRelation = function(path, val) {
    var allowedRelation, deferred, key, newVal, promises,
      _this = this;
    deferred = Q.defer();
    allowedRelation = function(rel) {
      var allowed, _i, _len, _ref;
      _ref = _this.$__.cascadeSaveConfig.limit;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        allowed = _ref[_i];
        if (allowed.substr(0, rel.length) === rel) {
          return true;
        }
      }
      return false;
    };
    if (this.$__.cascadeSaveConfig && this.$__.cascadeSaveConfig.limit && !allowedRelation(path)) {
      deferred.resolve();
      return deferred.promise;
    }
    promises = [];
    if (this.schema.paths[path]) {
      if (this.schema.paths[path].instance === 'ObjectID' && (this.schema.paths[path].options.ref != null)) {
        promises.push(this.$__saveSingleRelationAtPath(path));
      } else if (this.schema.paths[path].options.type instanceof Array && this.schema.paths[path].caster && this.schema.paths[path].caster.instance === 'ObjectID' && (this.schema.paths[path].caster.options.ref != null)) {
        promises.push(this.$__saveMultiRelationAtPath(path));
      }
    } else if (typeof val === 'object') {
      for (key in val) {
        newVal = val[key];
        promises.push(this.$__saveRelation(path + '.' + key, newVal));
      }
    }
    if (!promises.length) {
      deferred.resolve();
    } else {
      Q.all(promises).then(function() {
        return deferred.resolve();
      }, function(err) {
        return deferred.reject(err);
      });
    }
    return deferred.promise;
  };
  schema.methods.$__saveSingleRelationAtPath = function(path) {
    var data, deferred, ref, through,
      _this = this;
    deferred = Q.defer();
    ref = this.schema.paths[path].options.ref;
    through = this.schema.paths[path].options.$through;
    data = dot.get(this.get('_related'), path);
    this.$__saveRelatedDoc(path, data, ref, through).then(function(res) {
      _this.$__.populateRelations[path] = res;
      _this.set(path, res._id);
      return deferred.resolve();
    }, function(err) {
      return deferred.reject(err);
    });
    return deferred.promise;
  };
  schema.methods.$__saveMultiRelationAtPath = function(path) {
    var data, deferred, doc, promises, ref, through, _i, _len,
      _this = this;
    deferred = Q.defer();
    ref = this.schema.paths[path].caster.options.ref;
    through = this.schema.paths[path].caster.options.$through;
    data = dot.get(this.get('_related'), path);
    promises = [];
    if (!(data instanceof Array)) {
      deferred.reject(new Error("Data for multi relation must be an array!"));
    } else {
      for (_i = 0, _len = data.length; _i < _len; _i++) {
        doc = data[_i];
        promises.push(this.$__saveRelatedDoc(path, doc, ref, through));
      }
      Q.all(promises).then(function(results) {
        var result, _j, _len1;
        _this.$__.populateRelations[path] = {};
        for (_j = 0, _len1 = results.length; _j < _len1; _j++) {
          result = results[_j];
          _this.$__.populateRelations[path][result._id.toString()] = result;
        }
        return deferred.resolve();
      }, function(err) {
        return deferred.reject(err);
      });
    }
    return deferred.promise;
  };
  schema.methods.$__saveRelatedDoc = function(path, data, ref, through) {
    var allowed, d, deferred, filter, getPrototype, isArray, isNewModel, method, modelClass, newArr, newMod, orig, _i, _len, _ref,
      _this = this;
    deferred = Q.defer();
    if (through) {
      d = dot.get(data, through);
      if (d instanceof Array) {
        if (d.indexOf(this._id) < 0) {
          d.push(this._id);
          dot.set(data, through, d, true);
        }
      } else {
        dot.set(data, through, this._id, true);
      }
    }
    if (this.$__.cascadeSaveConfig && this.$__.cascadeSaveConfig.filter) {
      filter = this.$__.cascadeSaveConfig.filter;
      data = filter.apply(this, [data, path]);
    } else {
      filter = null;
    }
    modelClass = mongoose.model(ref);
    orig = this.get(path);
    if (orig instanceof Array) {
      isArray = true;
    } else {
      isArray = false;
    }
    getPrototype = function(object) {
      var funcNameRegex, results;
      funcNameRegex = /function (.{1,})\(/;
      results = funcNameRegex.exec(object.constructor.toString());
      if (results && results.length > 1) {
        return results[1];
      } else {
        return "";
      }
    };
    isNewModel = getPrototype(data) === 'model' && data.isNew;
    if (data._id && !isNewModel) {
      if (isArray) {
        if (orig.indexOf(data._id) < 0) {
          orig.push(data._id);
          this.set(path, orig);
        }
      } else {
        this.set(path, data._id);
      }
      modelClass.findById(data._id, function(err, res) {
        var allowed, method, newArr, _i, _len, _ref;
        if (err) {
          return deferred.reject(err);
        } else if (!res) {
          return deferred.reject(new Error('Could not find ref ' + ref + ' with ID ' + data._id.toString()));
        }
        delete data._id;
        res.set(data);
        newArr = null;
        if ((res.cascadeSave != null) && typeof res.cascadeSave === 'function') {
          method = 'cascadeSave';
          if (_this.$__.cascadeSaveConfig && (_this.$__.cascadeSaveConfig.limit != null)) {
            newArr = [];
            _ref = _this.$__.cascadeSaveConfig.limit;
            for (_i = 0, _len = _ref.length; _i < _len; _i++) {
              allowed = _ref[_i];
              if (allowed.substr(0, path.length + 1) === (path + '.')) {
                newArr.push(allowed.substr(path.length + 1));
              }
            }
          }
        } else {
          method = 'save';
        }
        return res[method](function(err, res) {
          if (err) {
            return deferred.reject(err);
          }
          return deferred.resolve(res);
        }, {
          limit: newArr,
          filter: filter
        });
      });
    } else {
      newMod = new modelClass(data);
      if (isArray) {
        orig.push = Array.prototype.push;
        orig.push(newMod._id);
        this.set(path, orig);
      } else {
        this.set(path, newMod._id);
      }
      newArr = null;
      if ((newMod.cascadeSave != null) && typeof newMod.cascadeSave === 'function') {
        method = 'cascadeSave';
        if (this.$__.cascadeSaveConfig && (this.$__.cascadeSaveConfig.limit != null)) {
          newArr = [];
          _ref = this.$__.cascadeSaveConfig.limit;
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            allowed = _ref[_i];
            if (allowed.substr(0, path.length + 1) === (path + '.')) {
              newArr.push(allowed.substr(path.length + 1));
            }
          }
        }
      } else {
        method = 'save';
      }
      newMod[method](function(err, res) {
        if (err) {
          return deferred.reject(err);
        }
        return deferred.resolve(res);
      }, {
        limit: newArr,
        filter: filter
      });
    }
    return deferred.promise;
  };
  schema.pre('save', function(next) {
    var path, promises, val, _ref;
    if (this.$__.cascadeSave) {
      this.$__.populateRelations = {};
      if (this._related != null) {
        promises = [];
        _ref = this._related;
        for (path in _ref) {
          val = _ref[path];
          promises.push(this.$__saveRelation(path, val));
        }
        return Q.all(promises).then(function() {
          return next();
        }, function(err) {
          return next(err);
        });
      } else {
        return next();
      }
    } else {
      return next();
    }
  });
  schema.pre('save', function(next) {
    var curVal, id, newRelated, newVal, path, rels, _i, _len, _ref;
    if (this.$__.cascadeSave) {
      newRelated = {};
      _ref = this.$__.populateRelations;
      for (path in _ref) {
        rels = _ref[path];
        curVal = this.get(path);
        if (curVal instanceof Array) {
          newVal = [];
          for (_i = 0, _len = curVal.length; _i < _len; _i++) {
            id = curVal[_i];
            if (rels[id.toString()] != null) {
              newVal.push(rels[id.toString()]);
            } else {
              newVal.push(id);
            }
          }
          dot.set(newRelated, path, newVal, true);
        } else {
          if (rels._id === curVal) {
            dot.set(newRelated, path, rels, true);
          } else {
            dot.set(newRelated, path, curVal, true);
          }
        }
      }
      this.set('_related', newRelated);
      this.$__.cascadeSave = false;
    }
    return next();
  });
  schema.methods.$__handleDeletion = function(path) {
    if (this.schema.paths[path].instance === 'ObjectID' && (this.schema.paths[path].options.ref != null)) {
      return this.$__handleDeletionAtSingleRelationPath(path);
    } else if (this.schema.paths[path].options.type instanceof Array && this.schema.paths[path].caster && this.schema.paths[path].caster.instance === 'ObjectID' && (this.schema.paths[path].caster.options.ref != null)) {
      return this.$__handleDeletionAtMultiRelationPath(path);
    }
  };
  schema.methods.$__handleDeletionAtSingleRelationPath = function(path) {
    var cascade, ref, through;
    ref = this.schema.paths[path].options.ref;
    cascade = this.schema.paths[path].options.$cascadeDelete;
    through = this.schema.paths[path].options.$through;
    return this.$__handleDeletionOfDoc(ref, this.get(path), cascade, through);
  };
  schema.methods.$__handleDeletionAtMultiRelationPath = function(path) {
    var cascade, data, id, ref, through, _i, _len, _results;
    ref = this.schema.paths[path].caster.options.ref;
    cascade = this.schema.paths[path].caster.options.$cascadeDelete;
    through = this.schema.paths[path].caster.options.$through;
    data = this.get(path);
    _results = [];
    for (_i = 0, _len = data.length; _i < _len; _i++) {
      id = data[_i];
      _results.push(this.$__handleDeletionOfDoc(ref, id, cascade, through));
    }
    return _results;
  };
  schema.methods.$__handleDeletionOfDoc = function(ref, id, cascade, through) {
    var modelClass;
    modelClass = mongoose.model(ref);
    if (cascade) {
      return modelClass.findById(id, function(err, res) {
        if (res) {
          return res.remove();
        }
      });
    } else if (through) {
      return modelClass.findById(id, function(err, res) {
        if (res) {
          res.set(through, null);
          return res.save();
        }
      });
    }
  };
  return schema.post('remove', function(doc) {
    var config, path, _ref, _results;
    _ref = this.schema.paths;
    _results = [];
    for (path in _ref) {
      config = _ref[path];
      _results.push(this.$__handleDeletion(path));
    }
    return _results;
  });
};
