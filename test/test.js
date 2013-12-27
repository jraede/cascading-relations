var barClass, barSchema, bazClass, bazSchema, fooClass, fooSchema, mongoose, relations, should;

mongoose = require('mongoose');

relations = require('../index');

should = require('should');

mongoose.connect('mongodb://localhost/mongoose_relations_test');

mongoose.set('debug', true);

barSchema = new mongoose.Schema({
  _foo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Foo',
    $through: '_bar'
  },
  _baz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Baz',
    $through: '_bar',
    $cascadeDelete: true
  },
  title: String
});

fooSchema = new mongoose.Schema({
  title: String,
  _bars: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bar'
    }
  ],
  _bar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bar',
    $through: '_foo'
  },
  multi: {
    _bar: {
      type: mongoose.Schema.Types.ObjectId,
      $cascadeDelete: true,
      ref: 'Bar'
    },
    _bars: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bar'
      }
    ]
  }
});

bazSchema = new mongoose.Schema({
  title: String,
  _bar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bar',
    $through: '_baz'
  }
});

fooSchema.plugin(relations.plugin);

barSchema.plugin(relations.plugin);

bazSchema.plugin(relations.plugin);

barClass = mongoose.model('Bar', barSchema);

fooClass = mongoose.model('Foo', fooSchema);

bazClass = mongoose.model('Baz', bazSchema);

describe('Testing', function() {
  this.timeout(10000);
  it('should populate on $related and leave IDs intact', function(done) {
    var bar;
    bar = new barClass({
      title: 'My Bar'
    });
    return bar.save(function(err, res) {
      var foo;
      foo = new fooClass({
        title: 'My Foo',
        multi: {
          _bars: [res._id]
        }
      });
      return foo.cascadeSave(function(err, res) {
        return mongoose.model('Foo').find().populate('multi._bars').exec(function(err, res) {
          res[0].multi._bars[0].toString().should.equal(bar._id.toString());
          res[0]._related.multi._bars[0].title.should.equal('My Bar');
          return done();
        });
      });
    });
  });
  it('should cascade save relations', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        multi: {
          _bars: [
            {
              title: 'First Bar'
            }, {
              title: 'Second Bar'
            }
          ],
          _bar: {
            title: 'Third Bar'
          }
        },
        _bar: {
          title: 'Fourth Bar'
        },
        _bars: [
          {
            title: 'Fifth Bar'
          }, {
            title: 'Sixth Bar'
          }
        ]
      }
    });
    return foo.cascadeSave(function(err, res) {
      _this.foo = foo;
      res._related._bars[0].title.should.equal('Fifth Bar');
      res._related._bar.title.should.equal('Fourth Bar');
      res._related.multi._bars[1].title.should.equal('Second Bar');
      res._related.multi._bar.title.should.equal('Third Bar');
      res._related._bar._foo.toString().should.equal(res._id.toString());
      return done();
    });
  });
  it('should cascade delete when designated', function(done) {
    var deletedBarId, throughBarId;
    deletedBarId = this.foo.multi._bar;
    throughBarId = this.foo._bar;
    return this.foo.remove(function(err, res) {
      return setTimeout(function() {
        return barClass.findById(deletedBarId, function(err, res) {
          should.not.exist(res);
          return barClass.findById(throughBarId, function(err, res) {
            should.not.exist(res._foo);
            return done();
          });
        });
      }, 5000);
    });
  });
  it('should cascade save multiple levels deep', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        multi: {
          _bar: {
            title: 'My Bar',
            _related: {
              _baz: {
                title: 'My Baz'
              }
            }
          }
        }
      }
    });
    return foo.cascadeSave(function(err, result) {
      _this.foo = result;
      result._related.multi._bar._related._baz.title.should.equal('My Baz');
      result._related.multi._bar._related._baz._bar.toString().should.equal(result._related.multi._bar._id.toString());
      return done();
    });
  });
  it('should cascade delete multiple levels deep', function(done) {
    var deletedBazId;
    deletedBazId = this.foo._related.multi._bar._related._baz._id;
    return this.foo.remove(function(err, res) {
      return setTimeout(function() {
        return bazClass.findById(deletedBazId, function(err, res) {
          should.not.exist(res);
          return done();
        });
      }, 5000);
    });
  });
  return it('should do normal save without cascading', function(done) {
    var foo;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        _bar: {
          title: 'My Bar'
        }
      }
    });
    return foo.save(function(err, result) {
      should.not.exist(foo._bar);
      return done();
    });
  });
});
